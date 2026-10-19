import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digits, samePhone, toE164AU } from '../lib/phone.js';
import { dialVapi, reject, sayAndHangup, xmlEscape } from '../lib/twiml.js';
import { findCallSids, pickByCallerAndTime } from '../lib/match.js';
import { timingSafeEqualString } from '../lib/http.js';
import { assistantConfig, voiceFor } from '../lib/assistant.js';
import { normalizeBaseUrl, normalizeSupabaseUrl } from '../lib/env.js';

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

test('Supabase URL is reduced to the project origin', () => {
  assert.equal(normalizeSupabaseUrl('https://abcd.supabase.co/rest/v1/'), 'https://abcd.supabase.co');
  assert.equal(normalizeSupabaseUrl('abcd.supabase.co'), 'https://abcd.supabase.co');
  assert.throws(() => normalizeSupabaseUrl('https://supabase.com/dashboard/project/abcd'), /控制台网址/);
});

test('token comparison', () => {
  assert.ok(timingSafeEqualString('abc', 'abc'));
  assert.ok(!timingSafeEqualString('abc', 'abd'));
  assert.ok(!timingSafeEqualString('', 'abc'));
});

test('assistant config is speech-to-speech, bilingual and privacy-safe', () => {
  const cfg = assistantConfig({
    ownerName: 'Michael',
    voice: 'male-mature',
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
  assert.equal(cfg.voice.voiceId, 'cedar');
  assert.match(prompt, /Never claim to be human/);
  assert.equal(cfg.firstMessageMode, 'assistant-waits-for-user');
  assert.equal(cfg.firstMessage, '');
  assert.equal(cfg.startSpeakingPlan, undefined);
  const hello = cfg.hooks.find((h) => h.on === 'customer.speech.timeout');
  assert.equal(hello.options.timeoutSeconds, 3);
  assert.equal(hello.options.triggerMaxCount, 1);
  assert.deepEqual(hello.do, [{ type: 'say', exact: 'Hello?' }]);
  assert.match(prompt, /this is Michael's AI assistant/);
  assert.match(prompt, /我是Michael的AI助手/);
  assert.match(prompt, /This is an AI phone assistant/);
  assert.match(prompt, /我是AI电话助手/);
  const anon = assistantConfig({ ownerName: '', voice: 'male-mature', serverUrl: 'https://x.test', webhookSecret: 's', maxCallSeconds: 300 });
  assert.match(anon.model.messages[0].content, /an AI assistant taking calls for this number/);
  assert.doesNotMatch(anon.model.messages[0].content, /Michael/);
  assert.match(prompt, /no goodbye, no pleasantries/);
  assert.equal(voiceFor('female-warm'), 'marin');
  assert.equal(voiceFor('nonsense'), 'cedar');
});

import { explainOutbound, isForwardedTestCall, summarizeTests } from '../lib/forwarding.js';

test('forwarded test calls are recognised even when caller ID is rewritten', () => {
  const base = { ourNumber: '+61258496666', ownerNumber: '+61412345678' };
  assert.ok(isForwardedTestCall({ ...base, from: '+61258496666', forwardedFrom: null, testActive: false }));
  assert.ok(isForwardedTestCall({ ...base, from: '+61412345678', forwardedFrom: null, testActive: true }));
  assert.ok(!isForwardedTestCall({ ...base, from: '+61412345678', forwardedFrom: null, testActive: false }));
  assert.ok(!isForwardedTestCall({ ...base, from: '+61499999999', forwardedFrom: null, testActive: true }));
});

test('forwarding test results are explained', () => {
  const base = { ourNumber: '+61258496666', ownerNumber: '+61412345678' };
  const t0 = new Date('2026-10-19T03:00:00Z');
  const at = (s) => new Date(t0.getTime() + s * 1000).toISOString();
  const now = t0.getTime() + 300 * 1000;
  const ok = summarizeTests(
    [
      { created_at: at(0), raw_params: { kind: 'outbound', status: 'completed', duration: 3 } },
      { created_at: at(25), forwarded_from: '+61412345678', raw_params: { kind: 'inbound', From: '+61258496666' } },
    ],
    { ...base, now }
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].ok, true);
  assert.match(ok[0].text, /共用号码/);
  const noAnswer = summarizeTests([{ created_at: at(0), raw_params: { kind: 'outbound', status: 'no-answer' } }], { ...base, now });
  assert.equal(noAnswer[0].ok, false);
  assert.match(noAnswer[0].text, /\*\*61\*/);
  assert.match(explainOutbound({ status: 'completed', gotInbound: false }).text, /实时语音留言/);
  const waiting = summarizeTests([{ created_at: at(0), raw_params: { kind: 'outbound', status: 'dialing' } }], { ...base, now: t0.getTime() + 30000 });
  assert.equal(waiting[0].ok, null);
});

test('carrier ForwardedFrom without country code is normalised and matched', () => {
  assert.equal(toE164AU('+478558140'), '+61478558140');
  assert.equal(toE164AU('0478558140'), '+61478558140');
  assert.equal(toE164AU('+61478558140'), '+61478558140');
  assert.equal(toE164AU('+12025550123'), '+12025550123');
  assert.equal(toE164AU(null), null);
  assert.ok(samePhone('+478558140', '+61478558140'));
  assert.ok(!samePhone('+478558140', '+61420576667'));
});
