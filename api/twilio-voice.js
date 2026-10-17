// Twilio 号码的「来电」webhook。
// 流程：校验请求确实来自 Twilio → 记录转移来源等信息 → 黑名单直接拒接 → 其余桥接给 Vapi 语音助理。
import twilio from 'twilio';
import { db, logDbError } from '../lib/db.js';
import { env, baseUrl, sipUri } from '../lib/env.js';
import { bodyOf, sendXml } from '../lib/http.js';
import { samePhone } from '../lib/phone.js';
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
  const forwardedFrom = params.ForwardedFrom || null;
  const owner = env('OWNER_PHONE_NUMBER');
  const ourNumber = env('TWILIO_PHONE_NUMBER');

  // 呼叫转移测试：我们自己的号码打给机主，机主不接，电话又被转回来。
  if (samePhone(from, ourNumber)) {
    logDbError(
      'forward_tests.insert',
      await db().from('forward_tests').insert({
        call_sid: callSid,
        forwarded_from: forwardedFrom,
        matched_owner: samePhone(forwardedFrom, owner),
        raw_params: params,
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
