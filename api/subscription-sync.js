// App 购买或恢复购买后调用：提交 StoreKit 2 交易的 JWS，服务端验证苹果签名后立即开通。
// 之后的续费、过期、退款由 /api/appstore-notifications 更新。
import { authenticate } from '../lib/auth.js';
import { AppStoreError, verifyTransaction } from '../lib/appstore.js';
import { entitlementOf, GRACE_DAYS } from '../lib/entitlement.js';
import { bodyOf, sendJson } from '../lib/http.js';
import { applyTransaction } from '../lib/subscriptions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const auth = await authenticate(req);
  if (!auth?.user) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const { signedTransaction } = bodyOf(req);
  if (!signedTransaction) {
    sendJson(res, 400, { error: '缺少 signedTransaction' });
    return;
  }
  try {
    const transaction = await verifyTransaction(signedTransaction);
    const row = await applyTransaction({ transaction, requestingUserId: auth.user.id });
    const subscription = entitlementOf(row);
    sendJson(res, 200, { ok: true, subscription: { ...subscription, graceDays: GRACE_DAYS } });
  } catch (err) {
    const status = err instanceof AppStoreError ? err.status : 500;
    if (status >= 500) console.error('subscription-sync 失败', err);
    sendJson(res, status, { error: err.message });
  }
}
