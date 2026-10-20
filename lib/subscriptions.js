// 把一笔苹果交易写进 subscriptions 表。App 同步和苹果服务器通知共用。
import { db, logDbError } from './db.js';
import { AppStoreError, resolveOwner, subscriptionRow } from './appstore.js';

// 返回写入后的那一行；是比现有记录旧的交易时返回现有记录；无法确定用户时返回 null。
export async function applyTransaction({ transaction, renewal = null, notificationType = null, requestingUserId = null }) {
  const bound = await db()
    .from('subscriptions')
    .select('user_id')
    .eq('original_transaction_id', transaction.originalTransactionId)
    .maybeSingle();
  if (logDbError('subscriptions.select by original_transaction_id', bound)) throw new AppStoreError('数据库错误', 500);

  const { userId, conflict } = resolveOwner({ transaction, boundUserId: bound.data?.user_id, requestingUserId });
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
