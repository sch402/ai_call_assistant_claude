// 接口鉴权。两种身份：
//   admin：Bearer DASHBOARD_TOKEN，网页面板和管理接口用，能看全部数据。
//   user ：Bearer <Supabase 登录令牌>，iOS App 用手机号 + 短信验证码登录后拿到，只能看自己的数据。
import { db, logDbError } from './db.js';
import { env } from './env.js';
import { digits } from './phone.js';
import { timingSafeEqualString } from './http.js';

export function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

// Supabase 的登录令牌是 JWT：三段 base64url，用点隔开。
export function looksLikeJwt(token) {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(String(token || ''));
}

// Supabase 存的手机号不带 +（例如 61412345678），统一成 E.164。
export function authPhoneToE164(phone) {
  const d = digits(phone);
  return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
}

// 返回 { admin: true } 或 { user: { id, phone } }；令牌无效时返回 null。
export async function authenticate(req) {
  const token = bearerToken(req);
  if (!token) return null;
  if (timingSafeEqualString(token, env('DASHBOARD_TOKEN'))) return { admin: true };
  if (!looksLikeJwt(token)) return null;

  const { data, error } = await db().auth.getUser(token);
  const authUser = data?.user;
  if (error || !authUser) return null;
  const phone = authPhoneToE164(authUser.phone);
  // 只认验证过的手机号：来电归属完全依赖它
  if (!phone || !authUser.phone_confirmed_at) return null;

  // 首次登录时登记到 profiles，来电 webhook 靠这张表按号码找到用户
  logDbError(
    'profiles.upsert',
    await db()
      .from('profiles')
      .upsert({ user_id: authUser.id, phone }, { onConflict: 'user_id', ignoreDuplicates: true })
  );
  return { user: { id: authUser.id, phone } };
}
