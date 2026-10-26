import { test } from 'node:test';
import * as assert from 'node:assert';
import { interpret, emptyContext } from '../../web/src/desktop/intent-engine.ts';
import { fixtureSnapshot, sales, marketing } from './fixtures/voice-fixtures.ts';

const snap = () => fixtureSnapshot();
const ctx = () => emptyContext();

function check(utterance: string, intent: string, tier: number, sayPart: string, c = ctx()) {
  const r = interpret(utterance, snap(), c);
  assert.equal(r.intent, intent, `${utterance} intent`);
  assert.equal(r.tier, tier, `${utterance} tier`);
  assert.ok(r.say.includes(sayPart), `${utterance} say "${r.say}" should include "${sayPart}"`);
  return r;
}

test('FR-5 global and running/finished', () => {
  check('status', 'status.global', 0, 'waiting on you');
  check("what's running", 'status.running', 0, 'running');
  check('what finished', 'status.finished', 0, 'finished');
});

test('FR-6 per-room progress reuses roomProgress wording', () => {
  const r = check('How are we doing in Sales?', 'status.room', 0, 'Sales:');
  assert.deepEqual(r.visual, [{ kind: 'openRoom', roomId: sales.id }]);
  assert.equal(r.context.focusRoom?.id, sales.id);
  check("What's the latest progress in Engineering?", 'status.room', 0, 'Engineering:');
  check('Update on Marketing', 'status.room', 0, 'Marketing:');
});

test('FR-7 blocked list scoped and global', () => {
  const r = check('What is blocked?', 'status.blocked', 0, 'blocked');
  assert.ok(r.context.lastList && r.context.lastList.items.length >= 2);
  check("What's blocked in Support?", 'status.blocked', 0, 'blocked');
  const scoped = interpret('What is blocked in Sales?', snap(), ctx());
  assert.equal(scoped.intent, 'status.blocked');
});

test('FR-8/FR-16 needs-me and approval refusal R2', () => {
  const r = check('What needs me?', 'status.needsme', 0, 'waiting on you');
  assert.equal(r.visual[0].kind, 'focusApproval');
  check('How many approvals waiting?', 'status.needsme', 0, 'waiting on you');
  const refuse = interpret('Approve the first one', snap(), ctx());
  assert.equal(refuse.intent, 'approval.nav');
  assert.equal(refuse.tier, 3);
  assert.equal(refuse.say, 'I never approve by voice. Here is the card.');
  assert.equal(refuse.propose, undefined);
  assert.equal(refuse.confirm, undefined);
  const reject = interpret('Reject that', snap(), ctx());
  assert.equal(reject.say, 'I never approve by voice. Here is the card.');
});

test('FR-9 entity detail', () => {
  check('What is Sam doing?', 'entity.detail', 0, 'Sam');
  const noRoom = interpret('Who runs Finance?', snap(), ctx());
  assert.equal(noRoom.intent, 'unknown');
  const crew = interpret('Who runs Marketing?', snap(), ctx());
  assert.equal(crew.intent, 'entity.detail');
  assert.ok(crew.say.includes('Marketing'));
  const noBudget = interpret('How much budget left in Analytics?', snap(), ctx());
  assert.equal(noBudget.intent, 'unknown');
  const budget = interpret('How much budget left in Sales?', snap(), ctx());
  assert.ok(budget.say.includes('budget left'));
  check('Tell me about Marketing task 2', 'entity.detail', 0, ':');
});

test('FR-1 nav open happy, synonym, failure, fuzzy clarify', () => {
  const r = check('Open Sales', 'nav.open', 1, 'Sales.');
  assert.deepEqual(r.visual, [{ kind: 'openRoom', roomId: sales.id }]);
  check('Show Engineering', 'nav.open', 1, 'Engineering.');
  check('Go to settings', 'nav.open', 1, 'Settings.');
  check('Open Ada', 'nav.open', 1, 'Ada.');
  const fuzzy = interpret('Open sails', snap(), ctx());
  assert.ok(fuzzy.clarify, 'fuzzy sails should clarify, not execute');
  assert.equal(fuzzy.visual.length, 0);
  const miss = interpret('Open nowhere', snap(), ctx());
  assert.equal(miss.intent, 'unknown');
  assert.equal(miss.ok, false);
});

test('FR-2 ordinals, cross-room, out of range, open that', () => {
  const r = interpret('Open Marketing task 1', snap(), ctx());
  assert.equal(r.intent, 'nav.ordinal');
  assert.deepEqual(r.visual[0], { kind: 'openTask', taskId: 'task_1', roomId: marketing.id });
  const listed = interpret('What is blocked?', snap(), ctx());
  const second = interpret('Open the second one', snap(), listed.context);
  assert.equal(second.intent, 'nav.ordinal');
  const out = interpret('Open Marketing task 9', snap(), ctx());
  assert.equal(out.ok, false);
  assert.ok(out.say.includes('only'));
  assert.equal(out.visual.length, 0);
  const opened = interpret('Open Sales', snap(), ctx());
  const that = interpret('Open that', snap(), opened.context);
  assert.equal(that.intent, 'nav.open');
});

test('FR-3/FR-4 window and scroll', () => {
  check('Close this', 'nav.window', 1, 'Closed.');
  check('Park Sales', 'nav.window', 1, 'Sales.');
  check('Clear desk', 'nav.window', 1, 'cleared');
  check('Scroll down', 'nav.scroll', 1, 'Scrolled');
  const nxt = interpret('Next room', snap(), { ...ctx(), focusRoom: sales });
  assert.equal(nxt.intent, 'nav.scroll');
});

test('FR-10 search', () => {
  const r = check('Find mandates about pricing', 'search', 0, 'match');
  assert.ok(r.visual.some((v) => v.kind === 'launch'));
  check('Show failed tasks', 'search', 0, 'match');
  check('Find mandates about zzzqqq', 'search', 0, 'No matches');
});

test('FR-12 follow-up swaps room, pronoun owner', () => {
  const first = interpret('How are we doing in Sales?', snap(), ctx());
  const follow = interpret('What about Engineering?', snap(), first.context);
  assert.equal(follow.intent, 'followup.room');
  assert.ok(follow.say.includes('Engineering'));
  assert.equal(follow.context.focusRoom?.name, 'Engineering');
  const taskCtx = interpret('Open Marketing task 1', snap(), ctx());
  const owner = interpret('And who owns that?', snap(), taskCtx.context);
  assert.equal(owner.intent, 'entity.detail');
  const owner2 = interpret('Who is working on that?', snap(), taskCtx.context);
  assert.equal(owner2.intent, 'entity.detail');
});

test('FR-13 dispatch proposes, never commits directly', () => {
  const r = interpret('Fix the failing pricing test', snap(), ctx());
  assert.equal(r.intent, 'action.dispatch');
  assert.equal(r.tier, 2);
  assert.ok(r.propose);
  assert.equal(r.confirm, undefined);
});

test('FR-14/FR-15 agent, room pause, recall, route require confirm', () => {
  const stop = check('Stop Rex', 'action.agent', 2, 'Stop Rex?');
  assert.ok(stop.confirm);
  const run = check('Run Kit', 'action.agent', 2, 'Run Kit?');
  assert.ok(run.confirm);
  const pause = check('Pause Marketing', 'action.roompause', 2, 'Pause Marketing?');
  assert.ok(pause.confirm);
  const opened = interpret('Open Sales', snap(), ctx());
  void opened;
  const withMandate = interpret('Tell me about Marketing task 1', snap(), ctx());
  void withMandate;
  const recallCtx = { ...ctx(), focusMandate: snap().mandates[0] };
  const recall = interpret('Recall that', snap(), recallCtx);
  assert.equal(recall.intent, 'action.recall');
  assert.ok(recall.confirm);
  const route = interpret('Move that to Analytics', snap(), recallCtx);
  assert.equal(route.intent, 'unknown');
  const route2 = interpret('Move that to Marketing', snap(), recallCtx);
  assert.equal(route2.intent, 'action.route');
  assert.ok(route2.confirm);
});

test('FR-17 meta commands and clear resets context', () => {
  check('Repeat', 'meta.repeat', 0, 'nothing to repeat');
  check('Stop', 'meta.stop', 0, 'Stopped');
  check('Help', 'meta.help', 0, 'Try:');
  check('Talk slower', 'meta.speed', 1, 'Slower');
  check('Louder', 'meta.volume', 1, 'Louder');
  const dirty = interpret('Open Sales', snap(), ctx());
  const cleared = interpret('Forget that', snap(), dirty.context);
  assert.equal(cleared.intent, 'meta.clear');
  assert.equal(cleared.context.focusRoom, null);
  assert.equal(cleared.context.lastList, null);
});

test('confidence floor: unknown short utterance does not execute', () => {
  const r = interpret('Blorp', snap(), ctx());
  assert.equal(r.intent, 'unknown');
  assert.equal(r.ok, false);
  assert.ok(r.confidence < 0.75);
  assert.equal(r.visual.length, 0);
});
