// 给 iOS App 用的基础配置：代接号码（Twilio 号码）、机主名字、当前登录的手机号。
// 原型阶段所有用户共用一个 Twilio 号码，只有运营商带了转移来源才能把来电归到对应用户。
import { authenticate } from '../lib/auth.js';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const isOwner = Boolean(auth.admin || auth.user.isOwner);
  sendJson(res, 200, {
    twilioNumber: env('TWILIO_PHONE_NUMBER'),
    ownerName: isOwner ? env('OWNER_NAME', '') : '',
    phone: auth.user?.phone || null,
    isOwner,
    apiVersion: 2,
  });
}
