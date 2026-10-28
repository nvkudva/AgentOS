import { test } from 'node:test';
import * as assert from 'node:assert';
import { pickVoice } from '../../web/src/lib/voice.ts';

const voice = (lang: string, localService: boolean, name = lang) => ({ lang, localService, name });

test('pickVoice prefers an on-device English voice', () => {
  const picked = pickVoice([voice('fr-FR', true), voice('en-US', false, 'net'), voice('en-GB', true, 'local')]);
  assert.equal(picked?.name, 'local');
});

test('pickVoice falls back so speech is never silently dropped', () => {
  assert.equal(pickVoice([voice('de-DE', true)])?.lang, 'de-DE');
  assert.equal(pickVoice([voice('en-US', false)])?.lang, 'en-US');
  assert.equal(pickVoice([]), null);
});
