// 拉黑 / 取消拉黑一个号码。黑名单里的号码来电会被直接拒接，不消耗 AI 分钟。
//   App 用户：只影响打给自己的电话（user_blocks 表）
//   网页面板（DASHBOARD_TOKEN）：全局黑名单，对所有用户生效（blocklist 表）
import { authenticate } from '../../lib/auth.js';
import { db } from '../../lib/db.js';
import { bodyOf, sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const { number, reason, action } = bodyOf(req);
  if (!number || !/^\+?\d{6,15}$/.test(String(number))) {
    sendJson(res, 400, { error: '号码格式不正确' });
    return;
  }
  let result;
  if (auth.user) {
    const mine = db().from('user_blocks');
    result =
      action === 'remove'
        ? await mine.delete().eq('user_id', auth.user.id).eq('number', number)
        : await mine.upsert({ user_id: auth.user.id, number }, { onConflict: 'user_id,number' });
  } else {
    result =
      action === 'remove'
        ? await db().from('blocklist').delete().eq('number', number)
        : await db()
            .from('blocklist')
            .upsert({ number, reason: reason || null }, { onConflict: 'number' });
  }
  if (result.error) {
    sendJson(res, 500, { error: result.error.message });
    return;
  }
  sendJson(res, 200, { ok: true });
}
