// 拉黑 / 取消拉黑一个号码。黑名单里的号码来电会被直接拒接，不消耗 AI 分钟。
import { db } from '../../lib/db.js';
import { bodyOf, checkDashboardToken, sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  if (!checkDashboardToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
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
