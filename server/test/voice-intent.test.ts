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
  check("What's the latest progress in Engineering?", 'status.room', 0, 'Engineering \u2014 Kit reports:');
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
  const approve = interpret('Approve the first one', snap(), ctx());
  assert.equal(approve.intent, 'action.decide');
  assert.equal(approve.tier, 3);
  assert.ok(approve.confirm);
  assert.deepEqual(approve.decide, { inboxId: 'inb_1', decision: 'approve' });
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
  check('Never mind', 'meta.stop', 0, 'Stopped');
  check('Be quiet', 'meta.stop', 0, 'Stopped');
  check('Goodbye', 'meta.stop', 0, 'Going quiet');
  check("That's all", 'meta.stop', 0, 'Going quiet');
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

const visualOf = (text: string, c = ctx()) => interpret(text, snap(), c).visual;

test('room status phrasings are never dispatches', () => {
  for (const q of ["What's going on with the engineering team?", 'what is going on in sales', 'engineering team update',
    'Give me an update on marketing', "How's the sales team doing?", 'status of marketing']) {
    const r = interpret(q, snap(), ctx());
    assert.equal(r.intent, 'status.room', q);
    assert.equal(r.visual[0].kind, 'openRoom', q);
    assert.equal(r.propose, undefined, q);
  }
});

test('manager voices the room status', () => {
  check('engineering update', 'status.room', 0, 'Engineering \u2014 Kit reports:');
});

test('global brief', () => {
  for (const q of ["What's the latest update?", 'any updates', 'brief me', 'catch me up', "what's going on", "what's happening"]) {
    const r = interpret(q, snap(), ctx());
    assert.equal(r.intent, 'status.brief', q);
    assert.equal(r.tier, 0);
    assert.equal(r.visual[0].kind, 'focusApproval');
    assert.ok(r.say.includes('waiting on you'), r.say);
    assert.ok(r.say.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 3, r.say);
  }
});

test('open room and apps', () => {
  for (const q of ['open sales team dashboard', 'open the sales dashboard']) {
    assert.deepEqual(visualOf(q), [{ kind: 'openRoom', roomId: sales.id }], q);
  }
  assert.deepEqual(visualOf('show me the engineering team'), [{ kind: 'openRoom', roomId: 'room_eng' }]);
  const apps: [string, string][] = [['open music', 'music'], ['launch maps', 'maps'], ['start the music app', 'music'],
    ['open the ride app', 'ride'], ['open overview', 'floor'], ['open approvals', 'inbox'], ['open settings', 'settings']];
  for (const [q, app] of apps) assert.deepEqual(visualOf(q), [{ kind: 'launch', app }], q);
  check('open music', 'nav.open', 1, 'Music.');
});

test('close app, room, this, all', () => {
  assert.deepEqual(visualOf('close music'), [{ kind: 'window', op: 'close', winRef: 'music' }]);
  assert.deepEqual(visualOf('close the maps app'), [{ kind: 'window', op: 'close', winRef: 'maps' }]);
  assert.deepEqual(visualOf('close approvals'), [{ kind: 'window', op: 'close', winRef: 'inbox' }]);
  assert.deepEqual(visualOf('close the sales dashboard'), [{ kind: 'window', op: 'close', winRef: sales.id }]);
  assert.deepEqual(visualOf('close it'), [{ kind: 'window', op: 'close', winRef: 'top' }]);
  // "this" is the front-most window, not whichever room was last talked about
  assert.deepEqual(visualOf('close this', { ...ctx(), focusRoom: sales }), [{ kind: 'window', op: 'close', winRef: 'top' }]);
  for (const q of ['close all', 'close everything', 'close all windows']) {
    assert.deepEqual(visualOf(q), [{ kind: 'window', op: 'closeAll', winRef: null }], q);
  }
});

test('decisions need confirm and resolve targets', () => {
  for (const q of ['approve', 'approve this', 'approve it', 'yes approve it']) {
    const r = interpret(q, snap(), ctx());
    assert.equal(r.intent, 'action.decide', q);
    assert.equal(r.decide?.inboxId, 'inb_1', q);
    assert.ok(r.confirm, q);
  }
  const named = interpret("approve Sam's post", snap(), ctx());
  assert.equal(named.decide?.inboxId, 'inb_1');
  assert.equal(named.say, 'Sam wants to publish a post. Approve it? Say yes to confirm.');
  const second = interpret('approve the second one', snap(), ctx());
  assert.equal(second.decide?.inboxId, 'inb_2');
  for (const q of ['decline', 'reject this', 'deny', 'decline Kit', 'reject the second one']) {
    const r = interpret(q, snap(), ctx());
    assert.equal(r.decide?.decision, 'reject', q);
    assert.ok(r.confirm?.label.startsWith('Decline'), q);
    assert.equal(r.tier, 3);
  }
  const listed = interpret('what needs me', snap(), ctx());
  assert.equal(interpret('approve the first one', snap(), listed.context).decide?.inboxId, 'inb_1');
  const empty = interpret('approve', { ...snap(), inbox: [] }, ctx());
  assert.equal(empty.say, 'Nothing is waiting for a decision.');
  assert.equal(empty.decide, undefined);
});

test('undo and wake toggles', () => {
  for (const q of ['undo', 'undo that', 'take that back']) check(q, 'meta.undo', 1, 'Undone.');
  for (const q of ['turn on wake word', 'enable wake word']) {
    const r = check(q, 'meta.wake', 1, 'Wake word on.');
    assert.equal(r.wake, true);
  }
  for (const q of ['turn off wake word', 'disable wake word']) {
    const r = check(q, 'meta.wake', 1, 'Wake word off.');
    assert.equal(r.wake, false);
  }
});

test('stop all falls through, stop Rex stays an agent action', () => {
  for (const q of ['stop all', 'stop everyone', 'stop everything']) {
    const r = interpret(q, snap(), ctx());
    assert.equal(r.intent, 'unknown', q);
    assert.equal(r.clarify, undefined, q);
  }
  check('stop Rex', 'action.agent', 2, 'Stop Rex?');
});

test('wake phrases and trailing please are stripped', () => {
  check('hey atrium, what needs me', 'status.needsme', 0, 'waiting on you');
  check('ok atrium stop', 'meta.stop', 0, 'Stopped');
  check('agent os, brief me', 'status.brief', 0, 'waiting on you');
  check('open music please', 'nav.open', 1, 'Music.');
});

test('help mentions new commands', () => {
  check('help', 'meta.help', 0, 'brief me');
});
