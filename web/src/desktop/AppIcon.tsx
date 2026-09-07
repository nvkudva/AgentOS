/**
 * Dock icons, drawn rather than typed. Emoji glyphs read as text at 48px and change
 * shape per platform; a disc with a flat white mark is what a dock icon is here — round,
 * so an app tile and a room's crew face are obviously the same kind of object.
 */
export type IconName =
  | 'overview' | 'activity' | 'inbox' | 'settings'
  | 'music' | 'ride' | 'maps';

const SKIN: Record<IconName, [string, string]> = {
  overview: ['#5aa2f5', '#2f6fd0'],
  activity: ['#f7b955', '#e2842a'],
  inbox:    ['#6ad3a8', '#26a173'],
  settings: ['#9aa5b5', '#65707f'],
  music:    ['#fb5c74', '#e02d55'],
  ride:     ['#3a3f47', '#15181c'],
  maps:     ['#63c98a', '#2f9d63'],
};

/** Each mark is drawn inside a 24×24 box, centred on the tile. */
const MARK: Record<IconName, JSX.Element> = {
  overview: (
    <g fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M4 6.5 9 4.5l6 2 5-2v13l-5 2-6-2-5 2z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </g>
  ),
  activity: (
    <g fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 13h4l2.5-6.5L13 17l2.2-4h5.3" />
    </g>
  ),
  inbox: (
    <g fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M3.5 13.5 6 5h12l2.5 8.5v4a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M3.5 13.5H9a3 3 0 0 0 6 0h5.5" />
    </g>
  ),
  settings: (
    <g fill="none" stroke="#fff" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v3.2M12 18.2v3.2M21.4 12h-3.2M5.8 12H2.6M18.6 5.4l-2.3 2.3M7.7 16.3l-2.3 2.3M18.6 18.6l-2.3-2.3M7.7 7.7 5.4 5.4"
            strokeLinecap="round" />
    </g>
  ),
  music: (
    <g fill="#fff">
      <path d="M19 3.6 9.4 5.8a1.2 1.2 0 0 0-.9 1.2v8.6a3.4 3.4 0 1 0 1.8 3V9.6l7.9-1.8v5.3a3.4 3.4 0 1 0 1.8 3V4.8a1.2 1.2 0 0 0-1-1.2z" />
    </g>
  ),
  ride: (
    <g>
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.4" fill="#fff" />
      <path fill="#15181c" d="M12 7.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6zm0 2.1a2.7 2.7 0 1 1 0 5.4 2.7 2.7 0 0 1 0-5.4z" />
    </g>
  ),
  maps: (
    <g fill="none" stroke="#fff" strokeWidth="1.7" strokeLinejoin="round">
      <path d="M12 21s6.4-6.1 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 14.9 12 21 12 21z" />
      <circle cx="12" cy="10.4" r="2.4" />
    </g>
  ),
};

export function AppIcon({ name }: { name: IconName }) {
  const [a, b] = SKIN[name];
  const id = `ic-${name}`;
  return (
    <svg className="appicon" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={a} /><stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill={`url(#${id})`} />
      {MARK[name]}
    </svg>
  );
}
