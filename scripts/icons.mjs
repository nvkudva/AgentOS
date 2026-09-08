/**
 * Draws the app icons: the supervisor orb, the same way the stylesheet draws it.
 *
 * No dependency and no browser. The orb is two conic fields under spherical shading, and
 * those are cheaper to rasterise directly than to install something that can render CSS.
 * The stops below are copied from .plasma.a / .plasma.b / .orb-shade / .orb-dome in
 * web/src/styles.css — if the orb is retuned there, retune them here and re-run.
 *
 * Run: node scripts/icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../web/public/icons/', import.meta.url);

// ---- a minimal PNG writer -------------------------------------------------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;                        // 8-bit, truecolour + alpha
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;                   // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- colour helpers -------------------------------------------------------
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
                    h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** src over dst, both [r,g,b] with a separate alpha. */
const over = (dst, src, a) => [lerp(dst[0], src[0], a), lerp(dst[1], src[1], a), lerp(dst[2], src[2], a)];

/** Sample a list of [position, colour] stops the way a conic-gradient does. */
function ramp(stops, t) {
  t = ((t % 1) + 1) % 1;
  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i], [p1, c1] = stops[i + 1];
    if (t >= p0 && t <= p1) {
      const k = p1 === p0 ? 0 : (t - p0) / (p1 - p0);
      return [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k), lerp(c0[3], c1[3], k)];
    }
  }
  return stops[stops.length - 1][1];
}

// .plasma.a — conic-gradient(from 0deg, …)
const FIELD_A = [
  [0, hex('#0d1c58')], [0.12, hex('#3f5ae0')], [0.26, hex('#9061ff')], [0.40, hex('#4f7dff')],
  [0.55, hex('#22d3ee')], [0.70, hex('#2b8ae6')], [0.85, hex('#16307d')], [1, hex('#0d1c58')],
];
// .plasma.b — conic-gradient(from 140deg, …), painted at .65
const FIELD_B = [
  [0, [0, 0, 0, 0]], [0.18, hex('#a78bfaaa')], [0.34, [0, 0, 0, 0]],
  [0.62, hex('#34e6c0aa')], [0.80, [0, 0, 0, 0]], [1, [0, 0, 0, 0]],
];

/** Anti-aliased coverage of a disc edge. */
const disc = (d, r, soft = 1.3) => clamp01((r - d) / soft);

/**
 * @param size   pixels square
 * @param bleed  the sphere's diameter as a fraction of the canvas
 * @param ground false to leave the surround transparent
 */
function draw(size, { bleed = 0.86, ground = null } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const R = (size * bleed) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - c, dy = y - c;
      const d = Math.hypot(dx, dy);

      let rgb = ground ?? [0, 0, 0];
      let a = ground ? 1 : 0;

      const cover = disc(d, R);
      if (cover > 0) {
        // conic angle, matching CSS: 0 at 12 o'clock, increasing clockwise
        const ang = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1;
        let s = ramp(FIELD_A, ang).slice(0, 3);
        const b = ramp(FIELD_B, (ang - 140 / 360 + 1) % 1);
        s = over(s, b.slice(0, 3), b[3] * 0.65);

        const u = dx / R, v = dy / R;                       // -1..1 within the sphere
        const t = clamp01(d / R);

        // .orb-shade: a tight specular up-left, a shadowed underside, and a rim vignette
        const spec = clamp01(1 - Math.hypot((u + 0.38) / 0.48, (v + 0.56) / 0.48));
        s = over(s, [255, 255, 255], Math.pow(spec, 1.6) * 0.5);
        const under = clamp01(1 - Math.hypot((u - 0.48) / 1.16, (v - 0.64) / 1.16));
        s = over(s, [0, 0, 0], Math.pow(under, 1.7) * 0.4);
        s = over(s, [0, 0, 0], Math.pow(clamp01((t - 0.78) / 0.22), 1.4) * 0.3);

        // .orb-dome: the hard little highlight that sells the glass
        const dome = clamp01(1 - Math.hypot((u + 0.16) / 0.42, (v + 0.62) / 0.24));
        s = over(s, [255, 255, 255], Math.pow(dome, 1.3) * 0.9);

        rgb = a > 0 ? over(rgb, s, cover) : s;
        a = Math.max(a, cover);
      }

      px[i] = Math.round(rgb[0]); px[i + 1] = Math.round(rgb[1]);
      px[i + 2] = Math.round(rgb[2]); px[i + 3] = Math.round(a * 255);
    }
  }
  return png(size, px);
}

mkdirSync(OUT, { recursive: true });
const write = (name, buf) => {
  writeFileSync(new URL(name, OUT), buf);
  console.log(name, (buf.length / 1024).toFixed(1) + 'kB');
};

// The orb, edge to edge, on nothing — the launcher rounds it off itself.
write('icon-192.png', draw(192));
write('icon-512.png', draw(512));
// Maskable is cropped to a circle inside a 80% safe zone, so the sphere shrinks to fit
// it and the corners are filled with the drawer it sits in rather than left bare.
write('icon-maskable-512.png', draw(512, { bleed: 0.62, ground: [17, 21, 31] }));
// iOS ignores the manifest and will not round a transparent icon: give it a solid square.
write('apple-touch-icon.png', draw(180, { bleed: 0.8, ground: [17, 21, 31] }));
