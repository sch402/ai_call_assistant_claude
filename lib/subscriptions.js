// 把一笔苹果交易写进 subscriptions 表。App 同步和苹果服务器通知共用。
import { db, logDbError } from './db.js';
import { accountTokenUser, AppStoreError, resolveOwner, subscriptionRow } from './appstore.js';

// 返回写入后的那一行；是比现有记录旧的交易时返回现有记录；无法确定用户时返回 null。
export async function applyTransaction({ transaction, renewal = null, notificationType = null, requestingUserId = null }) {
  const bound = await db()
    .from('subscriptions')
    .select('user_id')
    .eq('original_transaction_id', transaction.originalTransactionId)
    .maybeSingle();
  if (logDbError('subscriptions.select by original_transaction_id', bound)) throw new AppStoreError('数据库错误', 500);

  // 交易里的 appAccountToken 是购买时登录的用户 ID，苹果会永久带着它（续费、恢复购买都一样）。
  // 如果那个账户已经被删除（用户删号后用同一个 Apple ID 重新注册），且这笔订阅没绑定到任何现存账户，
  // 就忽略这个旧标记，让当前用户接手；仍然存在的另一个账户则照样算冲突，防止一份订阅多人用。
  let owned = transaction;
  const tokenUser = accountTokenUser(transaction);
  if (!bound.data && tokenUser && tokenUser !== requestingUserId) {
    const holder = await db().auth.admin.getUserById(tokenUser);
    if (!holder.data?.user) {
      console.log('苹果交易的原账户已删除，交给当前用户', transaction.originalTransactionId);
      owned = { ...transaction, appAccountToken: undefined };
    }
  }

  const { userId, conflict } = resolveOwner({ transaction: owned, boundUserId: bound.data?.user_id, requestingUserId });
  if (conflict) throw new AppStoreError('这个 Apple ID 的订阅已经绑定到另一个手机号', 409);
  if (!userId) {
    console.warn('苹果交易找不到对应用户', transaction.originalTransactionId, notificationType);
    return null;
  }

  const existing = await db().from('subscriptions').select('*').eq('user_id', userId).maybeSingle();
  if (logDbError('subscriptions.select existing', existing)) throw new AppStoreError('数据库错误', 500);
  const row = subscriptionRow({ userId, transaction, renewal, notificationType, existing: existing.data });
  if (!row) return existing.data;

  const saved = await db().from('subscriptions').upsert(row, { onConflict: 'user_id' }).select().single();
  if (logDbError('subscriptions.upsert', saved)) throw new AppStoreError('数据库错误', 500);
  return saved.data;
}
