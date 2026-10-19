// Twilio 号码的「来电」webhook。
// 流程：校验请求确实来自 Twilio → 记录转移来源等信息 → 黑名单直接拒接 → 其余桥接给 Vapi 语音助理。
import twilio from 'twilio';
import { db, logDbError } from '../lib/db.js';
import { env, baseUrl, sipUri } from '../lib/env.js';
import { bodyOf, sendXml } from '../lib/http.js';
import { samePhone, toE164AU } from '../lib/phone.js';
import { isForwardedTestCall, TEST_WINDOW_SECONDS } from '../lib/forwarding.js';
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
  // 原始值保留在 raw_params 里；这里存补全后的标准格式。
  const forwardedFrom = toE164AU(params.ForwardedFrom || null);
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
        matched_owner: samePhone(forwardedFrom, owner),
        raw_params: { ...params, kind: 'inbound' },
      })
    );
    sendXml(res, sayAndHangup('Forwarding test received. Goodbye.'));
    return;
  }

  // 这通电话能否确认属于机主：只认运营商带来的转移来源，绝不猜。
  const attributed = samePhone(forwardedFrom, owner);

  // 数据库出错时只记日志，电话照常交给 AI 接听，不能因为记录失败而漏接。
  const blockResult = await db().from('blocklist').select('number').eq('number', from).maybeSingle();
  logDbError('blocklist.select', blockResult);
  const blocked = blockResult.data;

  const saved = await db().from('calls').upsert(
    {
      call_sid: callSid,
      from_number: from,
      to_number: params.To || null,
      forwarded_from: forwardedFrom,
      attributed,
      stir_verstat: params.StirVerstat || null,
      caller_country: params.FromCountry || null,
      status: blocked ? 'blocked' : 'answering',
      raw_params: params,
    },
    { onConflict: 'call_sid' }
  );
  logDbError('calls.upsert', saved);

  if (blocked) {
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
