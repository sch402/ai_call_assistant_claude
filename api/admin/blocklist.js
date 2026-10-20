// 拉黑 / 取消拉黑一个号码。黑名单里的号码来电会被直接拒接，不消耗 AI 分钟。
// 黑名单目前对所有用户生效，所以只有网页面板和机主能改；按用户分开的黑名单留到 MVP。
import { authenticate } from '../../lib/auth.js';
import { db } from '../../lib/db.js';
import { bodyOf, sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  if (auth.user && !auth.user.isOwner) {
    sendJson(res, 403, { error: '原型阶段只有机主可以拉黑号码' });
    return;
  }
  const { number, reason, action } = bodyOf(req);
  if (!number || !/^\+?\d{6,15}$/.test(String(number))) {
    sendJson(res, 400, { error: '号码格式不正确' });
    return;
  }
  const result =
    action === 'remove'
      ? await db().from('blocklist').delete().eq('number', number)
      : await db()
          .from('blocklist')
          .upsert({ number, reason: reason || null }, { onConflict: 'number' });
  if (result.error) {
    sendJson(res, 500, { error: result.error.message });
    return;
  }
  sendJson(res, 200, { ok: true });
}
