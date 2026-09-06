import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, rm, access } from 'node:fs/promises';
import path from 'node:path';

/**
 * Builds the repository the engineering room actually works in.
 *
 * `workspace/` and `workspace-remote.git/` are generated, not committed — a git repo
 * inside a git repo is a trap. The source of truth is `fixtures/pricing-service`, which
 * still contains the rounding bug, so a fresh clone can watch an agent find it, fix it,
 * run the real tests and push a real branch.
 */
const run = promisify(execFile);
const ROOT = path.resolve(process.cwd(), '..');
const SRC = path.join(ROOT, 'fixtures/pricing-service');
const WORK = process.env.ATRIUM_WORKSPACE ? path.resolve(process.env.ATRIUM_WORKSPACE) : path.join(ROOT, 'workspace');
const REMOTE = path.join(ROOT, 'workspace-remote.git');
const force = process.argv.includes('--force');

const exists = (p: string) => access(p).then(() => true, () => false);

if (await exists(WORK) && !force) {
  console.log('workspace already exists — pass --force to rebuild it');
  process.exit(0);
}
await rm(WORK, { recursive: true, force: true });
await rm(REMOTE, { recursive: true, force: true });
await mkdir(WORK, { recursive: true });
await cp(SRC, WORK, { recursive: true });

const git = (cwd: string, ...args: string[]) => run('git', args, { cwd });
await git(WORK, 'init', '-q', '-b', 'main');
await git(WORK, 'add', '-A');
await git(WORK, '-c', 'user.email=setup@atrium.local', '-c', 'user.name=Atrium Setup',
          'commit', '-qm', 'initial pricing service');
await run('git', ['init', '-q', '--bare', REMOTE]);
await git(WORK, 'remote', 'add', 'origin', REMOTE);
await git(WORK, 'push', '-q', '-u', 'origin', 'main');

// The bug is the point: the suite must fail here, and pass after the agent's patch.
const failed = await run('npm', ['test', '--silent'], { cwd: WORK }).then(() => false, () => true);
console.log(`workspace ready at ${WORK}`);
console.log(failed
  ? '  tests fail on main, as they should — the rounding bug is waiting for the engineering room'
  : '  WARNING: tests pass on main, so there is nothing for the engineering room to fix');
