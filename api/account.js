// 账户接口，需要 App 登录令牌：
//   PATCH  { name?, gender?, voiceStyle? }  修改 AI 助手设置，下一通来电生效（见 /api/vapi-webhook 的 assistant-request）
//   DELETE                                  删除账户（苹果审核要求 App 内可以删除账户）
// 删除时先删这位用户的来电记录，再删除 Supabase 里的登录用户；profiles、subscriptions 随之级联删除。
// 注意两件删账户做不到的事，由 App 在删除前提醒用户：
//   1. 苹果订阅的扣费由苹果管理，删账户不会停止续费，用户要自己在系统设置里取消
//   2. 手机上的呼叫转移在运营商那边，删账户后转过来的电话会被拒接，用户要自己拨 ##004# 取消
import { authenticate } from '../lib/auth.js';
import { db, logDbError } from '../lib/db.js';
import { bodyOf, sendJson } from '../lib/http.js';
import { PROFILE_FIELDS, profileView, validateProfileUpdate } from '../lib/profile.js';

export default async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'PATCH') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const auth = await authenticate(req);
  if (!auth?.user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  if (req.method === 'PATCH') {
    await updateProfile(req, res, auth.user.id);
    return;
  }
  const { id } = auth.user;

  // 先删通话记录（含转写和摘要）。失败就停下，不留下「账户没了但数据还在」的状态。
  if (logDbError('calls.delete for account', await db().from('calls').delete().eq('user_id', id))) {
    sendJson(res, 500, { error: '删除通话记录失败，请稍后再试' });
    return;
  }
  const { error } = await db().auth.admin.deleteUser(id);
  if (error) {
    console.error('删除登录用户失败', error.message);
    sendJson(res, 500, { error: '删除账户失败，请稍后再试' });
    return;
  }
  console.log('账户已删除', id);
  sendJson(res, 200, { ok: true });
}

async function updateProfile(req, res, userId) {
  const { update, error } = validateProfileUpdate(bodyOf(req));
  if (error) {
    sendJson(res, 400, { error });
    return;
  }
  // authenticate() 已确保 profiles 里有这一行
  const saved = await db()
    .from('profiles')
    .update(update)
    .eq('user_id', userId)
    .select(PROFILE_FIELDS)
    .single();
  if (logDbError('profiles.update', saved)) {
    sendJson(res, 500, { error: '保存失败，请稍后再试' });
    return;
  }
  sendJson(res, 200, { profile: profileView(saved.data) });
}
