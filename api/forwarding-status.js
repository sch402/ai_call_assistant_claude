// Twilio 回报「呼叫转移自测」那通外呼的最终状态（no-answer / busy / completed / failed …）。
import twilio from 'twilio';
import { db, logDbError } from '../lib/db.js';
import { env, baseUrl } from '../lib/env.js';
import { bodyOf } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const params = bodyOf(req);
  const signature = req.headers['x-twilio-signature'] || '';
  if (!twilio.validateRequest(env('TWILIO_AUTH_TOKEN'), signature, `${baseUrl()}/api/forwarding-status`, params)) {
    res.status(403).send('Invalid signature');
    return;
  }
  logDbError(
    'forward_tests.update outbound status',
    await db()
      .from('forward_tests')
      .update({
        raw_params: {
          kind: 'outbound',
          status: params.CallStatus || null,
          duration: Number(params.CallDuration || 0),
          answered_by: params.AnsweredBy || null,
        },
      })
      .eq('call_sid', params.CallSid)
  );
  res.status(204).end();
}
