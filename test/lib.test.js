import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digits, forwardedBelongsTo, samePhone, toE164 } from '../lib/phone.js';
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

test('ForwardedFrom is completed using CalledCountry, never guessed', () => {
  // 实测：Telstra/Optus 等转移时给的格式
  assert.equal(toE164('+478558140', 'AU'), '+61478558140');
  assert.equal(toE164('0478558140', 'AU'), '+61478558140');
  assert.equal(toE164('+61478558140', 'AU'), '+61478558140');
  // 国家未知或不在规则表里：不补全
  assert.equal(toE164('+478558140', ''), null);
  assert.equal(toE164('+478558140', 'CN'), null);
  // 长度对不上：不补全
  assert.equal(toE164('+47855814', 'AU'), null);
  assert.equal(toE164(null, 'AU'), null);
  assert.equal(toE164('2025550123', 'US'), '+12025550123');
});

test('attribution requires an exact E.164 match in the called country', () => {
  const owner = '+61478558140';
  assert.ok(forwardedBelongsTo({ forwardedFrom: '+478558140', calledCountry: 'AU', userNumber: owner }));
  // 原始来电方的国家不能代替 CalledCountry
  assert.ok(!forwardedBelongsTo({ forwardedFrom: '+478558140', calledCountry: undefined, userNumber: owner }));
  // 末 9 位相同但国家不同的号码不算同一个人
  assert.ok(!forwardedBelongsTo({ forwardedFrom: '+64478558140', calledCountry: 'AU', userNumber: owner }));
  assert.ok(!forwardedBelongsTo({ forwardedFrom: '+478558141', calledCountry: 'AU', userNumber: owner }));
  assert.ok(!forwardedBelongsTo({ forwardedFrom: null, calledCountry: 'AU', userNumber: owner }));
});

import { authPhoneToE164, bearerToken, isOwnerPhone, looksLikeJwt } from '../lib/auth.js';

test('auth helpers: bearer token, JWT shape, Supabase phone format', () => {
  assert.equal(bearerToken({ headers: { authorization: 'Bearer abc ' } }), 'abc');
  assert.equal(bearerToken({ headers: { authorization: 'Basic abc' } }), '');
  assert.equal(bearerToken({ headers: {} }), '');
  assert.ok(looksLikeJwt('eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl'));
  assert.ok(!looksLikeJwt('a-dashboard-token'));
  assert.ok(!looksLikeJwt('a.b'));
  // Supabase 存的手机号不带 +
  assert.equal(authPhoneToE164('61412345678'), '+61412345678');
  assert.equal(authPhoneToE164('+61412345678'), '+61412345678');
  assert.equal(authPhoneToE164(''), null);
  assert.equal(authPhoneToE164(undefined), null);
});

test('only the exact owner number counts as the owner', () => {
  assert.ok(isOwnerPhone('61412345678', '+61412345678'));
  assert.ok(!isOwnerPhone('61412345679', '+61412345678'));
  // 国内格式的 OWNER_PHONE_NUMBER 不做猜测补全
  assert.ok(!isOwnerPhone('61412345678', '0412345678'));
  assert.ok(!isOwnerPhone(null, '+61412345678'));
});

import { canAnswer, decideCall, entitlementOf } from '../lib/entitlement.js';

test('subscription states with a 3-day grace period', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  const at = (days) => new Date(now + days * 86400000).toISOString();
  assert.equal(entitlementOf(null, { now }).state, 'none');
  assert.equal(entitlementOf(null, { now, isOwner: true }).state, 'active');
  assert.equal(entitlementOf({ status: 'active', expires_at: null }, { now }).state, 'active');
  assert.equal(entitlementOf({ status: 'active', expires_at: at(1) }, { now }).state, 'active');
  const grace = entitlementOf({ status: 'active', expires_at: at(-2) }, { now });
  assert.equal(grace.state, 'grace');
  assert.equal(grace.graceEndsAt, at(1));
  assert.equal(entitlementOf({ status: 'active', expires_at: at(-3) }, { now }).state, 'expired');
  // 退款或人工停用：立即失效，没有宽限期
  assert.equal(entitlementOf({ status: 'revoked', expires_at: at(10) }, { now }).state, 'expired');
  assert.ok(canAnswer({ state: 'grace' }));
  assert.ok(!canAnswer({ state: 'none' }));
});

test('calls on the shared number are answered only for entitled, identified users', () => {
  const active = { state: 'active' };
  const expired = { state: 'expired' };
  assert.deepEqual(decideCall({ userId: 'u', entitlement: active, hasForwardedFrom: true }), {
    answer: true,
    status: 'answering',
    reason: 'active',
  });
  assert.equal(decideCall({ userId: 'u', entitlement: { state: 'grace' }, hasForwardedFrom: true }).answer, true);
  const unpaid = decideCall({ userId: 'u', entitlement: expired, hasForwardedFrom: true });
  assert.equal(unpaid.answer, false);
  assert.equal(unpaid.status, 'unpaid');
  // 机主还没登录过也照常接听
  assert.equal(decideCall({ userId: null, ownerMatch: true, entitlement: active, hasForwardedFrom: true }).answer, true);
  // 分不清是谁的：默认拒接
  const unknown = decideCall({ userId: null, entitlement: { state: 'none' }, hasForwardedFrom: true });
  assert.deepEqual(unknown, { answer: false, status: 'rejected', reason: 'unknown_user' });
  assert.equal(decideCall({ userId: null, entitlement: { state: 'none' }, hasForwardedFrom: false }).reason, 'no_forwarded_from');
  assert.equal(
    decideCall({ userId: null, entitlement: { state: 'none' }, hasForwardedFrom: false, acceptUnattributed: true }).answer,
    true
  );
});

import { AppStoreError, accountTokenUser, decodeJwsPart, pinnedRootCertificate, resolveOwner, subscriptionRow } from '../lib/appstore.js';

const jwsOf = (header, payload) =>
  [header, payload].map((o) => Buffer.from(JSON.stringify(o)).toString('base64url')).join('.') + '.sig';

test('App Store JWS: only a chain ending in Apple Root CA - G3 is accepted', () => {
  assert.deepEqual(decodeJwsPart(jwsOf({ alg: 'ES256' }, { environment: 'Sandbox' }), 1), { environment: 'Sandbox' });
  assert.throws(() => decodeJwsPart('nope', 1), AppStoreError);
  const fake = jwsOf({ alg: 'ES256', x5c: ['bGVhZg==', 'aW50ZXI=', 'cm9vdA=='] }, {});
  assert.throws(() => pinnedRootCertificate(fake), /不是苹果签发/);
  assert.throws(() => pinnedRootCertificate(jwsOf({ alg: 'ES256' }, {})), /缺少证书链/);
});

test('an Apple subscription is bound to exactly one user', () => {
  const me = '6c1f0b9e-0000-4000-8000-000000000001';
  const other = '6c1f0b9e-0000-4000-8000-000000000002';
  assert.equal(accountTokenUser({ appAccountToken: me.toUpperCase() }), me);
  assert.equal(accountTokenUser({ appAccountToken: 'not-a-uuid' }), null);
  // App 同步：自己买的、没有 appAccountToken 的（例如旧交易）都归当前用户
  assert.deepEqual(resolveOwner({ transaction: { appAccountToken: me }, requestingUserId: me }), { userId: me, conflict: false });
  assert.deepEqual(resolveOwner({ transaction: {}, requestingUserId: me }), { userId: me, conflict: false });
  // 别人买的、或已经绑定给别人的：冲突
  assert.equal(resolveOwner({ transaction: { appAccountToken: other }, requestingUserId: me }).conflict, true);
  assert.equal(resolveOwner({ transaction: { appAccountToken: me }, boundUserId: other, requestingUserId: me }).conflict, true);
  // 苹果通知：已绑定的优先，其次 appAccountToken
  assert.equal(resolveOwner({ transaction: { appAccountToken: me }, boundUserId: other }).userId, other);
  assert.equal(resolveOwner({ transaction: { appAccountToken: me } }).userId, me);
  assert.equal(resolveOwner({ transaction: {} }).userId, null);
});

test('Apple transactions become subscription rows; stale notifications are ignored', () => {
  const tx = {
    originalTransactionId: '2000000123',
    productId: 'com.everyone.callassistant.pro.monthly',
    expiresDate: Date.parse('2026-11-20T00:00:00Z'),
    signedDate: Date.parse('2026-10-20T00:00:00Z'),
    environment: 'Sandbox',
  };
  const row = subscriptionRow({ userId: 'u', transaction: tx, renewal: { autoRenewStatus: 1 }, notificationType: 'SUBSCRIBED' });
  assert.equal(row.status, 'active');
  assert.equal(row.expires_at, '2026-11-20T00:00:00.000Z');
  assert.equal(row.auto_renew, true);
  assert.equal(row.source, 'app_store');
  // 退款
  assert.equal(subscriptionRow({ userId: 'u', transaction: { ...tx, revocationDate: Date.now() }, notificationType: 'REFUND' }).status, 'revoked');
  // 比现有记录旧的通知不覆盖
  const existing = { source: 'app_store', original_transaction_id: '2000000123', last_signed_at: '2026-10-21T00:00:00+00:00' };
  assert.equal(subscriptionRow({ userId: 'u', transaction: tx, existing }), null);
  // 没有续费信息时保留原来的 auto_renew
  assert.equal(subscriptionRow({ userId: 'u', transaction: tx, existing: { auto_renew: false } }).auto_renew, false);
  // 不是自动续期订阅
  assert.equal(subscriptionRow({ userId: 'u', transaction: { originalTransactionId: '1' } }), null);
});
