// Twilio 号码的「来电」webhook。
// 流程：校验请求确实来自 Twilio → 按转移来源找到用户 → 订阅无效或无法归属的直接拒接
//      → 黑名单直接拒接 → 其余桥接给 Vapi 语音助理。拒接（<Reject>）在接通前完成，不产生通话费用。
import twilio from 'twilio';
import { db, logDbError } from '../lib/db.js';
import { env, baseUrl, sipUri } from '../lib/env.js';
import { bodyOf, sendXml } from '../lib/http.js';
import { forwardedBelongsTo, samePhone, toE164 } from '../lib/phone.js';
import { isForwardedTestCall, TEST_WINDOW_SECONDS } from '../lib/forwarding.js';
import { decideCall, entitlementOf } from '../lib/entitlement.js';
import { dialVapi, reject, sayAndHangup } from '../lib/twiml.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const params = bodyOf(req);
  const signature = req.headers['x-twilio-signature'] || '';
  const url = `${baseUrl()}/api/twilio-voice`;
  if (!twilio.validateRequest(env('TWILIO_AUTH_TOKEN'), signature, url, params)) {
    // 签名不对：可能是伪造请求，或 PUBLIC_BASE_URL 与 Twilio 里配置的网址不一致。
    console.warn('Twilio 签名校验失败', { url });
    res.status(403).send('Invalid signature');
    return;
  }

  const callSid = params.CallSid;
  const from = params.From || '';
  // 转移来源按 CalledCountry（我们这个 Twilio 号码所在国家）补全成 E.164；
  // 补全不了就保留原值，并且不归属给任何人。原始参数完整保存在 raw_params 里。
  const calledCountry = params.CalledCountry || params.ToCountry || null;
  const rawForwardedFrom = params.ForwardedFrom || null;
  const forwardedFrom = toE164(rawForwardedFrom, calledCountry) || rawForwardedFrom;
  const owner = env('OWNER_PHONE_NUMBER');
  const ourNumber = env('TWILIO_PHONE_NUMBER');

  // 呼叫转移测试：我们自己的号码打给机主，机主不接，电话又被转回来。
  // 有的运营商转移时会把来电显示改成机主号码，所以测试进行中的几分钟内也认这种情况。
  const since = new Date(Date.now() - TEST_WINDOW_SECONDS * 1000).toISOString();
  const pending = await db()
    .from('forward_tests')
    .select('id')
    .eq('raw_params->>kind', 'outbound')
    .gte('created_at', since)
    .limit(1);
  logDbError('forward_tests.select pending', pending);
  const testActive = Boolean(pending.data?.length);

  if (isForwardedTestCall({ from, forwardedFrom, ourNumber, ownerNumber: owner, testActive })) {
    logDbError(
      'forward_tests.insert inbound',
      await db().from('forward_tests').insert({
        call_sid: callSid,
        forwarded_from: forwardedFrom,
        matched_owner: forwardedBelongsTo({ forwardedFrom: rawForwardedFrom, calledCountry, userNumber: owner }),
        raw_params: { ...params, kind: 'inbound' },
      })
    );
    sendXml(res, sayAndHangup('Forwarding test received. Goodbye.'));
    return;
  }

  // 这通电话归谁：只认运营商带来的转移来源，补全成 E.164 后必须与某位用户的登录手机号完全一致。
  // profiles.phone 有唯一约束，所以最多只会匹配到一位用户。补全不了就不归属给任何人。
  const forwardedE164 = toE164(rawForwardedFrom, calledCountry);
  let userId = null;
  let lookupFailed = false;
  if (forwardedE164) {
    const profile = await db().from('profiles').select('user_id').eq('phone', forwardedE164).maybeSingle();
    lookupFailed = Boolean(logDbError('profiles.select by forwarded_from', profile));
    userId = profile.data?.user_id || null;
  }
  // 机主可能还没在 App 里登录过（profiles 里没有他），所以仍然单独和 OWNER_PHONE_NUMBER 比对一次。
  const ownerMatch = forwardedBelongsTo({ forwardedFrom: rawForwardedFrom, calledCountry, userNumber: owner });
  const attributed = Boolean(userId) || ownerMatch;

  // 订阅：到期后宽限 3 天，之后拒接。查询出错时按有效处理，宁可多接也不能因为数据库故障漏接付费用户。
  let entitlement = entitlementOf(null, { isOwner: ownerMatch });
  if (userId && !ownerMatch) {
    const sub = await db().from('subscriptions').select('status,expires_at').eq('user_id', userId).maybeSingle();
    entitlement = logDbError('subscriptions.select', sub) ? { state: 'active' } : entitlementOf(sub.data);
  }
  const decision = decideCall({
    userId,
    ownerMatch,
    entitlement,
    hasForwardedFrom: Boolean(forwardedE164),
    // 查不了用户表时同样先接听
    acceptUnattributed: lookupFailed || env('ACCEPT_UNATTRIBUTED_CALLS', 'false') === 'true',
  });

  // 数据库出错时只记日志，电话照常交给 AI 接听，不能因为记录失败而漏接。
  let blocked = null;
  if (decision.answer) {
    const blockResult = await db().from('blocklist').select('number').eq('number', from).maybeSingle();
    logDbError('blocklist.select', blockResult);
    blocked = blockResult.data;
  }
  const status = blocked ? 'blocked' : decision.status;

  const saved = await db().from('calls').upsert(
    {
      call_sid: callSid,
      from_number: from,
      to_number: params.To || null,
      forwarded_from: forwardedFrom,
      attributed,
      user_id: userId,
      stir_verstat: params.StirVerstat || null,
      caller_country: params.FromCountry || null,
      status,
      raw_params: { ...params, decision: decision.reason },
    },
    { onConflict: 'call_sid' }
  );
  logDbError('calls.upsert', saved);

  if (status !== 'answering') {
    sendXml(res, reject());
    return;
  }

  sendXml(
    res,
    dialVapi({
      sipUri: sipUri(),
      headers: { 'X-call_ref': callSid },
      timeLimitSeconds: Number(env('MAX_CALL_SECONDS', '300')),
    })
  );
}
