// 给 iOS App 用的基础配置：代接号码（Twilio 号码）、当前登录的手机号、AI 助手设置、订阅状态。
// 原型阶段所有用户共用一个 Twilio 号码，只有运营商带了转移来源才能把来电归到对应用户。
import { authenticate } from '../lib/auth.js';
import { db, logDbError } from '../lib/db.js';
import { entitlementOf, GRACE_DAYS } from '../lib/entitlement.js';
import { env } from '../lib/env.js';
import { sendJson } from '../lib/http.js';
import { PROFILE_FIELDS, profileView } from '../lib/profile.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (!auth?.user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const [sub, profile] = await Promise.all([
    db().from('subscriptions').select('status,expires_at,auto_renew').eq('user_id', auth.user.id).maybeSingle(),
    db().from('profiles').select(PROFILE_FIELDS).eq('user_id', auth.user.id).maybeSingle(),
  ]);
  logDbError('subscriptions.select', sub);
  const profileError = logDbError('profiles.select', profile);
  if (profileError) {
    // 最常见的原因：新增的字段还没建（没有重新运行 supabase/schema.sql）
    const missingColumn = /column .* does not exist|could not find .* column/i.test(profileError.message || '');
    sendJson(res, 500, {
      error: missingColumn
        ? '数据库还没更新：请在 Supabase SQL Editor 重新运行 supabase/schema.sql'
        : '读取设置失败，请稍后再试',
    });
    return;
  }
  sendJson(res, 200, {
    twilioNumber: env('TWILIO_PHONE_NUMBER'),
    phone: auth.user.phone,
    // name / gender / voiceStyle / complete（首次引导是否已完成）
    profile: profileView(profile.data),
    // state: active / grace / expired / none；autoRenew：苹果内购时用户是否还开着自动续费
    subscription: { ...entitlementOf(sub.data), graceDays: GRACE_DAYS, autoRenew: sub.data?.auto_renew ?? null },
    apiVersion: 5,
  });
}
