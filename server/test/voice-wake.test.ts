import { test } from 'node:test';
import * as assert from 'node:assert';
import * as wake from '../../web/src/lib/voice/wake.ts';

test('wake phrase variants Whisper produces', () => {
  for (const said of ['Atrium.', 'Hey Atrium', 'hey, atrium!', 'Hey, A trium.', 'OK atrium', 'Hey Agent OS.', 'agent o.s.', 'Um, hey Atrium', 'K-A-Trium, open music', 'KATRIAM, Open Music', 'KATrium, Open Music', 'Atriam']) {
    assert.ok(wake.matchWake(said).woke, said);
  }
});

test('wake phrase with a command keeps the command', () => {
  assert.deepEqual(wake.matchWake('Hey Atrium, open Sales.'), { woke: true, rest: 'open Sales.' });
  assert.deepEqual(wake.matchWake('Atrium what needs me'), { woke: true, rest: 'what needs me' });
  assert.deepEqual(wake.matchWake('K-A-Trium, Open Music'), { woke: true, rest: 'Open Music' });
});

test('no wake without the name', () => {
  for (const said of ['open sales', 'the atriums of the heart are fine', 'agents are working', 'hey there', 'kate is working', 'a trial run']) {
    assert.equal(wake.matchWake(said).woke, false, said);
  }
});

test('whisper silence hallucinations are noise', () => {
  for (const said of ['[BLANK_AUDIO]', ' (upbeat music) ', 'Thank you.', 'you', '']) assert.ok(wake.isNoise(said), said);
  assert.equal(wake.isNoise('open sales'), false);
  assert.equal(wake.clean('[BLANK_AUDIO] open sales'), 'open sales');
});

test('echo of the orb reply is told apart from the operator talking over it', () => {
  const reply = 'One waiting on you. The biggest is Nia in Marketing, about 5m.';
  assert.ok(wake.isEcho('the biggest is Nia in marketing', reply));
  assert.ok(wake.isEcho('One waiting on you.', reply));
  assert.equal(wake.isEcho('Approve this.', reply), false);
  assert.equal(wake.isEcho('open sales', reply), false);
});
