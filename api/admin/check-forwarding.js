// 呼叫转移自测：用 Twilio 号码给机主手机打一通电话，机主按拒接，
// 电话应被运营商转回 Twilio 号码。来电 webhook 会记录运营商是否带了「转移来源」(ForwardedFrom)。
import twilio from 'twilio';
import { env } from '../../lib/env.js';
import { checkDashboardToken, sendJson } from '../../lib/http.js';
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
  try {
    const client = twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
    const call = await client.calls.create({
      to: env('OWNER_PHONE_NUMBER'),
      from: env('TWILIO_PHONE_NUMBER'),
      twiml: pause(40),
      timeout: 30,
    });
    sendJson(res, 200, { ok: true, callSid: call.sid });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}
