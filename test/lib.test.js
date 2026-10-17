import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digits, samePhone } from '../lib/phone.js';
import { dialVapi, reject, sayAndHangup, xmlEscape } from '../lib/twiml.js';
import { findCallSids, pickByCallerAndTime } from '../lib/match.js';
import { timingSafeEqualString } from '../lib/http.js';
import { assistantConfig, firstMessage } from '../lib/assistant.js';
import { normalizeBaseUrl } from '../lib/env.js';

test('phone numbers in different formats compare equal', () => {
  assert.equal(digits('sip:+61412345678@sip.vapi.ai'), '61412345678');
  assert.ok(samePhone('+61412345678', '0412345678'));
  assert.ok(samePhone('+61412345678', 'sip:+61412345678@sip.vapi.ai'));
  assert.ok(!samePhone('+61412345678', '+61412345679'));
  assert.ok(!samePhone(null, '+61412345678'));
  assert.ok(!samePhone('', ''));
});

test('dial TwiML carries the call ref as an X- SIP header and is escaped', () => {
  const xml = dialVapi({
    sipUri: 'sip:bot@sip.vapi.ai',
    headers: { 'X-call_ref': 'CA123', empty: '' },
    timeLimitSeconds: 300,
  });
  assert.match(xml, /<Dial answerOnBridge="true" timeLimit="300"><Sip>sip:bot@sip\.vapi\.ai\?X-call_ref=CA123<\/Sip><\/Dial>/);
  assert.doesNotMatch(xml, /empty/);
  const two = dialVapi({ sipUri: 'sip:bot@sip.vapi.ai', headers: { 'X-a': '1', 'X-b': '2' } });
  assert.match(two, /X-a=1&amp;X-b=2/);
});

test('other TwiML helpers', () => {
  assert.match(reject(), /<Reject reason="busy"\/>/);
  assert.match(sayAndHangup('a <b>'), /a &lt;b&gt;<\/Say><Hangup\/>/);
  assert.equal(xmlEscape(`"'&`), '&quot;&apos;&amp;');
});

test('finds Twilio CallSids anywhere in a Vapi report', () => {
  const sid = 'CA' + 'a'.repeat(32);
  const report = { call: { phoneCallProviderDetails: { sip: { headers: { 'x-call_ref': sid } } } } };
  assert.deepEqual(findCallSids(report), [sid]);
  assert.deepEqual(findCallSids({ nothing: 'CA123' }), []);
});

test('fallback match picks the latest unmatched call from the same caller in the window', () => {
  const now = new Date('2026-10-15T07:00:00Z');
  const mins = (m) => new Date(now.getTime() - m * 60000).toISOString();
  const candidates = [
    { id: 1, from_number: '+61400000001', created_at: mins(5), vapi_call_id: null },
    { id: 2, from_number: '+61400000001', created_at: mins(2), vapi_call_id: 'already' },
    { id: 3, from_number: '+61400000002', created_at: mins(1), vapi_call_id: null },
    { id: 4, from_number: '+61400000001', created_at: mins(45), vapi_call_id: null },
  ];
  const picked = pickByCallerAndTime(candidates, {
    callerMatches: (n) => samePhone(n, '0400000001'),
    reportStartedAt: now.toISOString(),
  });
  assert.equal(picked.id, 1);
  const none = pickByCallerAndTime(candidates, {
    callerMatches: (n) => samePhone(n, '+61499999999'),
    reportStartedAt: now.toISOString(),
  });
  assert.equal(none, null);
});

test('base URL gets https:// and loses trailing slashes', () => {
  assert.equal(normalizeBaseUrl('aicallassistantclaude.vercel.app'), 'https://aicallassistantclaude.vercel.app');
  assert.equal(normalizeBaseUrl(' https://a.vercel.app/ '), 'https://a.vercel.app');
  assert.equal(normalizeBaseUrl('http://a.vercel.app'), 'https://a.vercel.app');
});

test('token comparison', () => {
  assert.ok(timingSafeEqualString('abc', 'abc'));
  assert.ok(!timingSafeEqualString('abc', 'abd'));
  assert.ok(!timingSafeEqualString('', 'abc'));
});

test('assistant config is speech-to-speech, bilingual and privacy-safe', () => {
  const cfg = assistantConfig({
    persona: 'Amy',
    recordingNotice: true,
    serverUrl: 'https://x.test/api/vapi-webhook',
    webhookSecret: 's',
    maxCallSeconds: 300,
  });
  assert.equal(cfg.model.model, 'gpt-realtime-2');
  assert.equal(cfg.transcriber, undefined);
  assert.equal(cfg.voice.provider, 'openai');
  assert.equal(cfg.artifactPlan.recordingEnabled, false);
  assert.deepEqual(cfg.model.tools, [{ type: 'endCall' }]);
  const prompt = cfg.model.messages[0].content;
  assert.match(prompt, /Mandarin/);
  assert.match(prompt, /never guess, confirm or deny/);
  assert.match(firstMessage({ persona: 'Amy', recordingNotice: true }), /transcribed/);
  assert.doesNotMatch(firstMessage({ persona: 'Amy', recordingNotice: false }), /transcribed/);
});
