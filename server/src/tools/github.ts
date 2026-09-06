import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolSpec } from '../runtime/types.js';
import { WORKSPACE } from './repo.js';

const run = promisify(execFile);
const REPO = process.env.ATRIUM_GH_REPO;                 // "owner/name"
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

/**
 * Opens a REAL pull request. Irreversible and externally visible → blast "high",
 * so the toolbelt always parks it for approval before this function ever runs.
 *
 * If ATRIUM_GH_REPO is unset the branch is still really pushed — to the local bare
 * remote in workspace-remote.git — and the result says mode:"local". It never
 * pretends a GitHub PR exists when none does.
 */
export const prOpen: ToolSpec = {
  name: 'github.pr.open',
  blast: 'high', reversible: false, external: true,
  summary: (a) => `open a pull request "${a.title}" from ${a.branch} into ${a.base ?? 'main'}`,
  touches: (a) => [REPO ? `github.com/${REPO}` : 'local git remote', `branch ${a.branch}`, `base ${a.base ?? 'main'}`],
  estimate: () => 10,
  async run(_ctx, args) {
    const base = args.base ?? 'main';
    await run('git', ['push', '-u', 'origin', args.branch, '--force-with-lease'], { cwd: WORKSPACE });
    if (!REPO || !TOKEN) {
      const { stdout } = await run('git', ['rev-parse', args.branch], { cwd: WORKSPACE });
      return { mode: 'local', branch: args.branch, base, head: stdout.trim(),
               note: 'pushed to the local bare remote; set ATRIUM_GH_REPO + GH_TOKEN for a github.com PR' };
    }
    const res = await fetch(`https://api.github.com/repos/${REPO}/pulls`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
      body: JSON.stringify({ title: args.title, head: args.branch, base, body: args.body ?? '' }),
    });
    const json: any = await res.json();
    if (!res.ok) throw new Error(`github ${res.status}: ${json?.message ?? ''}`);
    return { mode: 'github', number: json.number, url: json.html_url, state: json.state };
  },
};
