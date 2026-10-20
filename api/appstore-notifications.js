// App Store Server Notifications V2。在 App Store Connect › App 信息 › App Store 服务器通知里，
// 正式环境和沙盒环境的网址都填 https://<你的域名>/api/appstore-notifications，版本选 Version 2。
// 返回非 200 时苹果会重试，所以只有签名不对、或我们自己出错时才返回错误。
import { AppStoreError, verifyNotification } from '../lib/appstore.js';
import { bodyOf } from '../lib/http.js';
import { applyTransaction } from '../lib/subscriptions.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const { signedPayload } = bodyOf(req);
  try {
    const { notification, transaction, renewal } = await verifyNotification(signedPayload);
    const type = notification.notificationType;
    console.log('苹果通知', type, notification.subtype || '', transaction?.originalTransactionId || '');
    // 只处理自动续期订阅；TEST、退款申请（CONSUMPTION_REQUEST）等没有要更新的状态
    if (transaction?.expiresDate && type !== 'TEST' && type !== 'CONSUMPTION_REQUEST') {
      await applyTransaction({ transaction, renewal, notificationType: type });
    }
    res.status(200).end();
  } catch (err) {
    const status = err instanceof AppStoreError ? err.status : 500;
    console.error('处理苹果通知失败', err.message);
    res.status(status).end();
  }
}
