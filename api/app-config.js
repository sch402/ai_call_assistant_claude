// 给 iOS App 用的基础配置：代接号码（Twilio 号码）、机主名字、当前登录的手机号、订阅状态。
// 原型阶段所有用户共用一个 Twilio 号码，只有运营商带了转移来源才能把来电归到对应用户。
import { authenticate } from '../lib/auth.js';
import { db, logDbError } from '../lib/db.js';
import { entitlementOf, GRACE_DAYS } from '../lib/entitlement.js';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const isOwner = Boolean(auth.admin || auth.user.isOwner);
  let subscription = entitlementOf(null, { isOwner });
  let autoRenew = null;
  if (!isOwner) {
    const sub = await db()
      .from('subscriptions')
      .select('status,expires_at,auto_renew')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    logDbError('subscriptions.select', sub);
    subscription = entitlementOf(sub.data);
    autoRenew = sub.data?.auto_renew ?? null;
  }
  sendJson(res, 200, {
    twilioNumber: env('TWILIO_PHONE_NUMBER'),
    ownerName: isOwner ? env('OWNER_NAME', '') : '',
    phone: auth.user?.phone || null,
    isOwner,
    // state: active / grace / expired / none；expiresAt、graceEndsAt 为 ISO 时间或 null
    // autoRenew：苹果内购时用户是否还开着自动续费（null = 未知或手动开通）
    subscription: { ...subscription, graceDays: GRACE_DAYS, autoRenew },
    apiVersion: 4,
  });
}
