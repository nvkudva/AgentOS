import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ToolSpec } from '../runtime/types.js';
import { ScopeViolation } from '../errors.js';

const run = promisify(execFile);
export const WORKSPACE = process.env.ATRIUM_WORKSPACE ?? path.resolve(process.cwd(), '../workspace');

const inside = (p: string) => {
  const abs = path.resolve(WORKSPACE, p);
  if (!abs.startsWith(path.resolve(WORKSPACE) + path.sep)) throw new ScopeViolation('engineering', `path outside workspace: ${p}`);
  return abs;
};

export const repoRead: ToolSpec = {
  name: 'repo.read',
  blast: 'low', reversible: true, external: false,
  summary: (a) => `read ${a.path} from the workspace repo${a.ref ? ` at ${a.ref}` : ''}`,
  touches: (a) => [`workspace:${a.path}`],
  estimate: () => 0,
  async run(_ctx, args) {
    // Read from a ref, not from whatever the working tree happens to be on. A previous
    // run leaving the tree on its own branch must not make the next run a silent no-op.
    if (args.ref) {
      const { stdout } = await run('git', ['show', `${args.ref}:${args.path}`], { cwd: WORKSPACE });
      return { path: args.path, ref: args.ref, body: stdout };
    }
    const body = await readFile(inside(args.path), 'utf8');
    return { path: args.path, body };
  },
};

/** Writes to a real working tree on a real branch. Reversible (git), so no gate. */
export const repoPatch: ToolSpec = {
  name: 'repo.patch',
  blast: 'medium', reversible: true, external: false,
  summary: (a) => `edit ${a.path} on branch ${a.branch} (from ${a.from ?? 'main'})`,
  touches: (a) => [`workspace:${a.path}`, `branch ${a.branch}`],
  estimate: () => 1,
  async run(_ctx, args) {
    const g = (...xs: string[]) => run('git', xs, { cwd: WORKSPACE });
    await g('checkout', '-B', args.branch, args.from ?? 'main');
    await writeFile(inside(args.path), args.body, 'utf8');
    await g('add', '-A');
    await g('-c', 'user.email=agent@atrium.local', '-c', 'user.name=Atrium Agent', 'commit', '-m', args.message ?? 'agent change');
    const { stdout } = await g('rev-parse', 'HEAD');
    return { branch: args.branch, commit: stdout.trim() };
  },
};

/** Runs the workspace's real test command. */
export const repoTest: ToolSpec = {
  name: 'repo.test',
  blast: 'low', reversible: true, external: false,
  summary: () => 'run the workspace test suite',
  touches: () => ['workspace tests'],
  estimate: () => 1,
  async run() {
    try {
      const { stdout } = await run('npm', ['test', '--silent'], { cwd: WORKSPACE, timeout: 120_000 });
      return { passed: true, output: stdout.slice(-2000) };
    } catch (e: any) {
      return { passed: false, output: String(e.stdout ?? '').slice(-2000) + String(e.stderr ?? '').slice(-1000) };
    }
  },
};
