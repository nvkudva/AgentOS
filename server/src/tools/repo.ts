import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { withRoomLock } from '../db.js';
import type { ToolSpec } from '../runtime/types.js';
import { ScopeViolation } from '../errors.js';

const run = promisify(execFile);
export const WORKSPACE = process.env.ATRIUM_WORKSPACE ?? path.resolve(process.cwd(), '../workspace');
const GIT_TIMEOUT = 120_000;

const inside = (base: string, p: string) => {
  const abs = path.resolve(base, p);
  if (!abs.startsWith(path.resolve(base) + path.sep)) throw new ScopeViolation('engineering', `path outside workspace: ${p}`);
  return abs;
};

/**
 * A8: every room gets its own working tree (a git worktree on atrium/<key>),
 * so two engineering teams never interleave commits on one checkout. Trees are
 * created lazily and survive restarts; the shared WORKSPACE root stays the
 * origin they all fork from.
 */
export async function roomTree(roomKey: string): Promise<string> {
  const dir = path.join(WORKSPACE, 'rooms', roomKey);
  const exists = await access(path.join(dir, '.git')).then(() => true).catch(() => false);
  if (exists) return dir;
  const g = (...xs: string[]) => run('git', xs, { cwd: WORKSPACE, timeout: GIT_TIMEOUT });
  await g('worktree', 'add', dir, '-B', `atrium/${roomKey}`, 'main').catch(async () => {
    // A branch left behind by a removed tree: prune and start fresh.
    await g('worktree', 'prune');
    await g('worktree', 'add', dir, '-B', `atrium/${roomKey}`, 'main');
  });
  return dir;
}

export async function removeRoomTree(roomKey: string): Promise<void> {
  const dir = path.join(WORKSPACE, 'rooms', roomKey);
  await run('git', ['worktree', 'remove', '--force', dir], { cwd: WORKSPACE, timeout: GIT_TIMEOUT }).catch(() => {});
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

export const repoRead: ToolSpec = {
  name: 'repo.read',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `read ${a.path} from the workspace repo${a.ref ? ` at ${a.ref}` : ''}`,
  touches: (a) => [`workspace:${a.path}`],
  estimate: () => 0,
  async run(ctx, args) {
    // Reads are room-local too: a room reads the tree it patches, so it always
    // sees its own last commit. Refs are history — identical in every worktree.
    if (args.ref) {
      const { stdout } = await run('git', ['show', `${args.ref}:${args.path}`],
        { cwd: WORKSPACE, timeout: GIT_TIMEOUT });
      return { path: args.path, ref: args.ref, body: stdout };
    }
    // A read creates no state: rooms without a tree yet read the shared root.
    const dir = path.join(WORKSPACE, 'rooms', ctx.room.key);
    const tree = await access(path.join(dir, '.git')).then(() => dir).catch(() => WORKSPACE);
    const body = await readFile(inside(tree, args.path), 'utf8');
    return { path: args.path, body };
  },
};

/** Writes to the room's own tree on the room's own branch. Reversible (git), so no gate. */
export const repoPatch: ToolSpec = {
  name: 'repo.patch',
  blast: 'medium', reversible: true, external: false,
  summary: (a) => `edit ${a.path} on branch ${a.branch} (from ${a.from ?? 'main'})`,
  touches: (a) => [`workspace:${a.path}`, `branch ${a.branch}`],
  estimate: () => 1,
  async run(ctx, args) {
    return withRoomLock(ctx.room.key, async () => {
      const tree = await roomTree(ctx.room.key);
      const g = (...xs: string[]) => run('git', xs, { cwd: tree, timeout: GIT_TIMEOUT });
      await g('checkout', '-B', args.branch, args.from ?? 'main');
      await writeFile(inside(tree, args.path), args.body, 'utf8');
      await g('add', '-A');
      await g('-c', 'user.email=agent@atrium.local', '-c', 'user.name=Atrium Agent', 'commit', '-m', args.message ?? 'agent change');
      const { stdout } = await g('rev-parse', 'HEAD');
      return { branch: args.branch, commit: stdout.trim(), tree };
    });
  },
};

/** Runs the room tree's real test command, under the room's lock. */
export const repoTest: ToolSpec = {
  name: 'repo.test',
  blast: 'low', reversible: true, external: false,
  summary: () => 'run the workspace test suite',
  touches: () => ['workspace tests'],
  estimate: () => 1,
  async run(ctx) {
    return withRoomLock(ctx.room.key, async () => {
      const tree = await roomTree(ctx.room.key);
      try {
        const { stdout } = await run('npm', ['test', '--silent'], { cwd: tree, timeout: 120_000 });
        return { passed: true, output: stdout.slice(-2000) };
      } catch (e: any) {
        return { passed: false, output: String(e.stdout ?? '').slice(-2000) + String(e.stderr ?? '').slice(-1000) };
      }
    });
  },
};
