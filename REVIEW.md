# Code review — AgentOS

A single-operator "agent workspace" (internally Atrium): a Node/Postgres server that runs scripted agent policies inside permission-scoped "rooms", gates every tool call on scope, human approval and spend, and a React desktop-metaphor UI that watches it over SSE.

Read in full: `server/src` (all), `server/scripts/migrate.ts`, `setup-workspace.ts`, `server/test/*`, `db/migrations/*`, `scripts/*.sh`, `web/src/lib/api.ts`, `web/vite.config.ts`, root and workspace manifests. Skimmed or unread: most of `web/src` (App.tsx, `desktop/`, `apps/`, `components/`), `web/src/lib/demo.ts`, `prd.md`, `README.md`, `fixtures/`, the remaining `server/scripts/*`.

## Architecture

Four layers, no framework anywhere.

**Transport** — `server/src/index.ts` is a bare `http.createServer`: one SSE endpoint (`/api/stream`, line 17), a JSON dispatcher for `/api/*` (line 27), and a static file server for `web/dist` (line 45). No router, no middleware, no auth.

**API** — `server/src/api.ts:handle` is an if-chain of path regexes returning plain objects; `status` rides inside the response body and is pulled back out at `index.ts:36`. It is entirely CRUD-over-`q()` plus one non-trivial function, `decide()` (line 142), which resolves an approval and re-animates the parked run.

**Runtime** — the real system. `runtime/scheduler.ts` polls every `ATRIUM_TICK_MS` (400ms) for agents in state `working` and advances each one step (`tick`, line 116; `step`, line 48). Policies are hand-written arrays of steps in `policies/index.ts` — `analyticsWeekly`, `engineeringFix`, `supportTriage`, etc. — each step calling `callTool`. Per-run state is a `scratch` jsonb blob on `run`, with control flags smuggled in as `__step`, `__repeat`, `__sameStep`, `__approval_granted`, `__pending` (`scheduler.ts:56-103`).

**Gate** — `runtime/toolbelt.ts:callTool` is the chokepoint and the best-designed thing here: room status, tool grant, cross-room arg check, approval, transactional spend, then execute (lines 26-96). Every branch appends to the event log first.

**State** — Postgres, and only Postgres. `event` is the append-only spine (`db/migrations/001_init.sql:49`); `room`/`agent`/`run` are projections. `src/replay.ts:fold()` is a second, independent definition of those projections, and `test/replay.test.ts` asserts fold == live tables. That is a genuinely strong invariant, and it is tested rather than asserted in prose.

The strongest structural idea is that a room's permissions live in two places at once: `room.tool_grants` (checked at `toolbelt.ts:33`) and a real Postgres role with real GRANTs (`provision.ts:19-53`, used via `db.ts:rolePool`). `test/scope.test.ts:38-48` proves the second layer holds even if the first is bypassed. `provision.ts:provisionRoom` then makes a room pure data — role, grants, row, agents — so `test/newroom.test.ts` can create a room at runtime and hold it to the same rules.

Where it will hurt:

- **Policies are code, tools are code, but rooms are data.** `provision.ts:84` refuses a room whose agents' policies need tools the room lacks — so every new *kind* of work still means editing `policies/index.ts` and redeploying. The "a room is a form, not a deploy" claim only holds for recombinations of the nine existing policies.
- **`scratch` is an untyped control block.** `scheduler.ts:78-80` deletes `__repeat`/`__approval_granted`/`__pending` by hand; `policies/index.ts` sets its own `s.__done` that the scheduler knows nothing about, so every downstream step in `engineeringFix` and `supportTriage` opens with `if (s.__done) return;` — burning a step, a tick and a `steps_used` increment each time. There is no step-level "abort run" primitive.
- **`api.ts` mixes routing, SQL and business rules in one function.** `decide()` (142-177) reads an approval, writes it, appends an event, mutates the room's permission policy, mutates the run and mutates the agent — six statements, no transaction. A crash midway leaves an approved approval whose run never resumes.
- **The scheduler is a single-process global.** `startScheduler()` runs unconditionally at `index.ts:58` with an in-memory `inflight` Set (`scheduler.ts:12`). Two server processes against one database will double-step every agent; there is no lease or `FOR UPDATE SKIP LOCKED`.
- **Per-step query cost is fixed and unbatched.** Each `step()` issues ~6 queries and each `callTool` another 2 reads plus a transaction (`toolbelt.ts:26-27`, `budget.ts:13-38`) — at 400ms ticks this scales linearly with live agents and is the first thing to fall over.

## Code quality

Comments are unusually good: they say *why*, and they name the decision (`D2`, `D3`, `R1`, `R3`, `R4`) that the test suite then checks. The error taxonomy in `errors.ts` — `ScopeViolation` / `NeedsApproval` / `BudgetExceeded` — is small and does real work, since `scheduler.ts:83-99` branches on it to decide park vs halt vs fail.

Concrete problems:

- **Approval-to-argument binding is broken.** `toolbelt.ts:9` — `JSON.stringify(o, Object.keys(o ?? {}).sort())` passes an array as the *replacer*, which filters properties at **every** nesting level to that flat list of top-level key names. Any nested object in a tool's args is stripped before comparison at line 56, so an approval granted for `{a:{x:1}}` also matches `{a:{x:99}}`. Today's tools happen to take flat args, so `test/budget.test.ts:39` passes; the guarantee is one nested arg away from silently failing.
- **Pending-approval reuse ignores args.** `toolbelt.ts:58` looks up an existing pending approval by `run_id` + `tool` only. Two calls to the same tool with different args in one run share one card, so the operator approves the text of call A while call B is what was blocked.
- **The cost model is estimate-only.** `runtime/types.ts:39` says the estimate is "charged before the call and trued up after"; no true-up exists anywhere. `toolbelt.ts:81-83` charges `spec.estimate(args)` and every estimate is a hard-coded constant (`sql.ts:18`, `github.ts:23`). Budgets are therefore call counters, not spend.
- **No typechecking on the server.** There is no `server/tsconfig.json` and no `typecheck` script; `tsx` strips types without checking them. Combined with `q<any>`, `one<any>` and `catch (e: any)` throughout `api.ts` and `scheduler.ts`, server types are documentation. The web workspace does have `web/tsconfig.json` with `strict: true`, but `noEmit` and no script invokes `tsc`.
- **Dev proxy points at the wrong port.** `web/vite.config.ts:5` proxies `/api` to `localhost:8788`; the server defaults to `8787` (`server/src/index.ts:8`, `scripts/serve.sh:6`). `npm run dev` cannot reach its own API.
- **Errors vanish in the UI.** `web/src/lib/api.ts:26-29` — `post` and `get` both end in `.catch(() => ({}))`. An approve that 500s is indistinguishable from one that worked; the comment justifies this for the serverless demo build, but it applies to the real app too.
- **`es.onmessage` parses without a guard** (`web/src/lib/api.ts:71`): one malformed frame throws inside the handler.
- **`truncate` is obfuscated** (`toolbelt.ts:111-113`): `JSON.parse(JSON.stringify(String(s).slice(0,4000) + '…'))` is a round-trip that returns its input string.
- **Tests are integration-only and undeclared.** All four suites in `server/test` require a live Postgres already migrated *and seeded* — `scope.test.ts:46` asserts `bizdata.orders` is non-empty, `newroom.test.ts:69` asserts `support.ticket` is non-empty. There is no CI config in the repo, no fixture bootstrap in `npm test`, and no test at all for `api.ts:handle`, `decide()` or any web code. What is covered is covered well (scope, budget, approval single-use, replay fidelity, runtime room creation).
- **Dependency hygiene is excellent**: `pg` and `react` are the only runtime dependencies across both workspaces.
- **Secrets**: no secrets are committed; `.env.example` is placeholders only; `GH_TOKEN` is read from the environment at `github.ts:8`. But tool args — which contain query results and customer data — are written verbatim into the `event` payload (`toolbelt.ts:92`) and broadcast to every unauthenticated SSE subscriber.
- **Dead config**: `.env.example` documents `AGENT_DRIVER=llm` / `ANTHROPIC_API_KEY`; no code reads either. The only references are in `README.md:115` and `prd.md:384`.

## Risks

- **The API has no authentication of any kind, and sets `access-control-allow-origin: *`** (`index.ts:13`). Anyone who can reach the port — or any web page the operator visits, since preflight is answered blanket at line 15 — can create rooms, raise budgets (`api.ts:125`), approve pending high-blast actions (`api.ts:106`), and toggle the panic stop. The entire human-in-the-loop design assumes a trusted network and says so nowhere.
- **Room database roles are created with `LOGIN PASSWORD '<rolename>'`** (`provision.ts:114`, `scripts/migrate.ts:36`, consumed at `db.ts:22`). Every room role has a password equal to its own name. Anyone who can open a Postgres connection is `atrium_analytics`.
- **`POST /api/approvals/:id/decide` with `remember: true` permanently rewrites `room.approval_policy`** (`api.ts:157`), converting a whole blast-radius class to `auto` for that room — from an unauthenticated request.
- **`sql.query` runs attacker-shaped SQL under the simple query protocol** (`sql.ts:26`, no params → multi-statement is possible at the protocol level). The only guard is two regexes (`sql.ts:5-6`) matching `select|with` at the start and banning write keywords anywhere — which also false-positive-rejects any query containing the word "update" in a string literal. Postgres GRANTs are the real defence and they hold, but there is no `statement_timeout` and no `LIMIT` pushed to the server, so `SELECT pg_sleep(600)` or a full scan of a large table is available to any policy: the whole result set is materialised before `rows.slice(0, 200)` at line 27.
- **One shared git working tree, no locking.** `repo.patch` runs `git checkout -B` then `git add -A` in `WORKSPACE` (`repo.ts:44-47`). Two engineering agents stepping concurrently will interleave branch checkouts and commit each other's files; `git add -A` also commits anything else in the tree. `repo.patch` and `github.pr.open`'s `git push --force-with-lease` (`github.ts:26`) have no timeout, so a git prompt hangs a scheduler slot forever.
- **`rolePool` grows without bound** (`db.ts:18-26`): a `Pool` of up to 4 connections per room key, never evicted, on top of the 12-connection main pool. Enough rooms exhausts `max_connections`.
- **Unbounded writes from unauthenticated input**: `/api/observe` (`api.ts:134`) inserts arbitrary jsonb with no size or rate limit; `/api/budget` (`api.ts:126`) accepts any `cents`, including negative, with no validation.
- **`provisionRoom` is not transactional** (`provision.ts:112-134`): role creation, grants, room insert and agent inserts are four separate steps. A failure part-way leaves an orphan Postgres role or a room with no agents. Nothing ever drops a role, and there is no delete-room endpoint.
- **Migrations have no version table** (`scripts/migrate.ts:28`): every `.sql` file is re-executed on every run. It works today only because each file is written idempotently; the first non-idempotent migration corrupts data on the second run.
- **SSE has no client cap or backpressure handling** (`index.ts:17-24`): `bus.setMaxListeners(200)` is the only limit, writes are never checked, and each `refresh` frame causes every connected client to re-issue the full `/api/state` snapshot.

## Action items

| Priority | Item | File | Why |
|---|---|---|---|
| P0 | Add authentication to every `/api/*` route and replace `access-control-allow-origin: *` with an allowlist | `server/src/index.ts:13` | Any page or host can approve high-blast actions, raise budgets and create rooms |
| P0 | Generate a random password per room role instead of reusing the role name | `server/src/provision.ts:114`, `server/scripts/migrate.ts:36`, `server/src/db.ts:22` | Every room's database credentials are guessable from its name |
| P0 | Fix `stable()` — use a recursive key-sorted serializer, not a `JSON.stringify` replacer array | `server/src/runtime/toolbelt.ts:9` | Nested tool args are stripped before comparison, so an approval matches args it was never granted for |
| P1 | Include an args hash in the pending-approval lookup, or key approvals on `(run_id, tool, args)` | `server/src/runtime/toolbelt.ts:58` | Operator approves the description of one call while a different call is what resumes |
| P1 | Point the Vite dev proxy at 8787, or read the port from one place | `web/vite.config.ts:5` | `npm run dev` cannot reach its own API |
| P1 | Add `server/tsconfig.json` with `strict` and a `typecheck` script wired into `npm test` | `server/package.json` | `tsx` never checks types; server types currently guarantee nothing |
| P1 | Set `statement_timeout` and a server-side `LIMIT`/row cap on role pools | `server/src/db.ts:22`, `server/src/tools/sql.ts:26` | A policy can hang a connection or materialise an entire table |
| P1 | Wrap `decide()` in a transaction | `server/src/api.ts:142` | A crash mid-sequence leaves an approved approval whose run never resumes |
| P1 | Validate `/api/budget` and rate-limit or size-cap `/api/observe` | `server/src/api.ts:126`, `server/src/api.ts:134` | Unvalidated cents and unbounded jsonb inserts from unauthenticated callers |
| P1 | Serialise `repo.patch` per workspace (advisory lock or a per-run clone) and add `timeout` to every `execFile` | `server/src/tools/repo.ts:42`, `server/src/tools/github.ts:26` | Concurrent engineering agents corrupt each other's branches; a hung git call holds a slot forever |
| P1 | Surface fetch failures in the UI rather than swallowing them | `web/src/lib/api.ts:26` | A failed approve looks identical to a successful one |
| P1 | Add a migrations version table and stop re-running every file | `server/scripts/migrate.ts:28` | Idempotence is currently a convention, not a guarantee |
| P1 | Make `npm test` bootstrap its own schema and seed, and add a CI workflow | `server/package.json`, `server/test/helpers.ts` | Suites silently depend on a hand-seeded database; nothing runs them automatically |
| P2 | Either implement the true-up or delete the claim and rename `estimate` to `cost` | `server/src/runtime/types.ts:39`, `server/src/runtime/toolbelt.ts:83` | Budgets are call counters described as spend |
| P2 | Give policies a first-class "end run" result instead of `s.__done` | `server/src/policies/index.ts:71`, `server/src/runtime/scheduler.ts:78` | Every remaining step still ticks, says something and burns step budget |
| P2 | Take a room lease (`FOR UPDATE SKIP LOCKED`) in `tick()` instead of an in-process `inflight` Set | `server/src/runtime/scheduler.ts:12` | Two server processes double-step every agent |
| P2 | Make `provisionRoom` transactional and add room deletion that drops the role | `server/src/provision.ts:112` | Partial failures leave orphan Postgres roles and agent-less rooms |
| P2 | Remove `AGENT_DRIVER` / `ANTHROPIC_API_KEY` from `.env.example` or implement the driver | `.env.example` | Documented configuration that no code reads |
| P2 | Cap SSE subscribers and stop re-broadcasting full snapshots on every `refresh` | `server/src/index.ts:17` | Each event fans out into one `/api/state` fetch per connected client |
| P2 | Replace the `truncate` JSON round-trip with a plain string slice | `server/src/runtime/toolbelt.ts:111` | Obfuscated no-op in the hottest logging path |
