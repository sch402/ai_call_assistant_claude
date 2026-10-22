// 修改 AI 助手设置：PATCH { name?, gender?, voiceStyle? }，需要 App 登录令牌。
// 下一通来电接通时就会用新设置（见 /api/vapi-webhook 的 assistant-request）。
import { authenticate } from '../lib/auth.js';
import { db, logDbError } from '../lib/db.js';
import { bodyOf, sendJson } from '../lib/http.js';
import { PROFILE_FIELDS, profileView, validateProfileUpdate } from '../lib/profile.js';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const auth = await authenticate(req);
  if (!auth?.user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const { update, error } = validateProfileUpdate(bodyOf(req));
  if (error) {
    sendJson(res, 400, { error });
    return;
  }
  // authenticate() 已确保 profiles 里有这一行
  const saved = await db()
    .from('profiles')
    .update(update)
    .eq('user_id', auth.user.id)
    .select(PROFILE_FIELDS)
    .single();
  if (logDbError('profiles.update', saved)) {
    sendJson(res, 500, { error: '保存失败，请稍后再试' });
    return;
  }
  sendJson(res, 200, { profile: profileView(saved.data) });
}
