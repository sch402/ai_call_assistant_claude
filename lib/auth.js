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

  await syncProfilePhone(authUser.id, phone);
  return { user: { id: authUser.id, phone } };
}

// profiles.phone 必须和登录系统里验证过的手机号一致：来电 webhook 靠它按号码找到用户。
// 以登录系统（auth.users）为准：首次登录时创建，号码变了（例如在 Supabase 后台改过）就跟着更新。
// 如果这个号码还挂在别的用户的旧记录上（那个用户已经换号或改号），先把旧记录改回它自己现在的号码，
// 对方已没有号码就删掉那条旧记录；登录系统保证同一个号码只属于一个登录用户。
async function syncProfilePhone(userId, phone) {
  const mine = await db().from('profiles').select('phone').eq('user_id', userId).maybeSingle();
  if (logDbError('profiles.select own', mine)) return;
  if (mine.data?.phone === phone) return; // 绝大多数请求到这里就结束，只多一次查询

  const stale = await db().from('profiles').select('user_id').eq('phone', phone).neq('user_id', userId);
  if (!logDbError('profiles.select stale', stale)) {
    for (const row of stale.data || []) {
      const other = await db().auth.admin.getUserById(row.user_id);
      const otherPhone = authPhoneToE164(other.data?.user?.phone);
      const fix =
        otherPhone && otherPhone !== phone
          ? db().from('profiles').update({ phone: otherPhone }).eq('user_id', row.user_id)
          : db().from('profiles').delete().eq('user_id', row.user_id);
      logDbError('profiles.fix stale phone', await fix);
    }
  }
  logDbError('profiles.upsert', await db().from('profiles').upsert({ user_id: userId, phone }, { onConflict: 'user_id' }));
}
