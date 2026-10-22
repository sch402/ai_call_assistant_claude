// 呼叫转移自测（网页面板）：POST { to: '+61…' }，用 Twilio 号码给被测手机打一通电话，
// 对方按拒接或不接，电话应被运营商转回 Twilio 号码。外呼的最终状态由 /api/forwarding-status 回调记录，
// 转回来的来电由 /api/twilio-voice 记录，面板据此给出诊断。
import twilio from 'twilio';
import { db, logDbError } from '../../lib/db.js';
import { env, baseUrl } from '../../lib/env.js';
import { bodyOf, checkDashboardToken, sendJson } from '../../lib/http.js';
import { pause } from '../../lib/twiml.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  if (!checkDashboardToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const to = String(bodyOf(req).to || '').replace(/[\s()-]/g, '');
  if (!/^\+\d{8,15}$/.test(to)) {
    sendJson(res, 400, { error: '请填写要测试的手机号，E.164 格式，例如 +61412345678' });
    return;
  }
  try {
    const client = twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
    const call = await client.calls.create({
      to,
      from: env('TWILIO_PHONE_NUMBER'),
      twiml: pause(60),
      // 比运营商「无人接听转移」的等待时间（通常 5–30 秒）长，避免 Twilio 先挂断。
      timeout: 60,
      statusCallback: `${baseUrl()}/api/forwarding-status`,
      statusCallbackEvent: ['completed'],
      statusCallbackMethod: 'POST',
    });
    logDbError(
      'forward_tests.insert outbound',
      await db()
        .from('forward_tests')
        .insert({ call_sid: call.sid, raw_params: { kind: 'outbound', status: 'dialing', to } })
    );
    sendJson(res, 200, { ok: true, callSid: call.sid });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}
