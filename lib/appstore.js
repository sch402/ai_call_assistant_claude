// 苹果内购（自动续期订阅）：验证苹果签名的 JWS，并把交易换算成 subscriptions 表的一行。
//
// 两个入口共用这里的逻辑：
//   /api/subscription-sync         App 购买或恢复购买后，把交易 JWS 发过来，马上生效
//   /api/appstore-notifications    苹果服务器通知（续费、过期、退款等），之后的状态都靠它更新
//
// 签名校验用苹果官方库 @apple/app-store-server-library。它需要苹果根证书：
// JWS 头部的 x5c 证书链最后一张就是根证书，这里只在它的 SHA-256 指纹等于 Apple Root CA - G3 时才采用。
import { createHash } from 'node:crypto';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { env } from './env.js';

// https://www.apple.com/certificateauthority/ 的 Apple Root CA - G3
export const APPLE_ROOT_CA_G3_SHA256 =
  '63343ABFB89A6A03EBB57E9B3F5FA7BE7C4F5C756F3017B3A8C488C3653E9179';

export class AppStoreError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// 不验证签名，只读出 JWS 的某一段（用来提前知道环境、取根证书）。
export function decodeJwsPart(jws, index) {
  const part = String(jws || '').split('.')[index];
  if (!part) throw new AppStoreError('JWS 格式不正确');
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new AppStoreError('JWS 格式不正确');
  }
}

// 取出 x5c 里的根证书，并核对指纹。
export function pinnedRootCertificate(jws) {
  const chain = decodeJwsPart(jws, 0).x5c;
  if (!Array.isArray(chain) || chain.length < 2) throw new AppStoreError('JWS 缺少证书链');
  const root = Buffer.from(chain[chain.length - 1], 'base64');
  const fingerprint = createHash('sha256').update(root).digest('hex').toUpperCase();
  if (fingerprint !== APPLE_ROOT_CA_G3_SHA256) throw new AppStoreError('证书链不是苹果签发的');
  return root;
}

// 沙盒（TestFlight、App 审核、沙盒测试账号）默认接受；正式上架后可以设 APPLE_ALLOW_SANDBOX=false。
function verifierFor(environment, root) {
  const isSandbox = environment === Environment.SANDBOX;
  if (!isSandbox && environment !== Environment.PRODUCTION) {
    throw new AppStoreError(`不支持的环境 ${environment}`);
  }
  if (isSandbox && env('APPLE_ALLOW_SANDBOX', 'true') !== 'true') {
    throw new AppStoreError('不接受沙盒交易', 403);
  }
  // 正式环境必须提供 App Apple ID（App Store Connect › App 信息 › Apple ID，一串数字）
  const appAppleId = isSandbox ? undefined : Number(env('APPLE_APP_APPLE_ID'));
  return new SignedDataVerifier([root], false, environment, env('APPLE_BUNDLE_ID'), appAppleId);
}

async function verifyWith(jws, environment, decode) {
  try {
    return await decode(verifierFor(environment, pinnedRootCertificate(jws)));
  } catch (err) {
    if (err instanceof AppStoreError) throw err;
    throw new AppStoreError(`苹果签名校验失败（${err?.status ?? err?.message ?? 'unknown'}）`);
  }
}

export function verifyTransaction(signedTransaction) {
  const { environment } = decodeJwsPart(signedTransaction, 1);
  return verifyWith(signedTransaction, environment, (v) => v.verifyAndDecodeTransaction(signedTransaction));
}

// 返回 { notification, transaction, renewal }；transaction / renewal 可能为空（例如 TEST 通知）。
export async function verifyNotification(signedPayload) {
  const environment = decodeJwsPart(signedPayload, 1).data?.environment;
  const notification = await verifyWith(signedPayload, environment, (v) =>
    v.verifyAndDecodeNotification(signedPayload)
  );
  const { signedTransactionInfo, signedRenewalInfo } = notification.data || {};
  const transaction = signedTransactionInfo
    ? await verifyWith(signedTransactionInfo, environment, (v) => v.verifyAndDecodeTransaction(signedTransactionInfo))
    : null;
  const renewal = signedRenewalInfo
    ? await verifyWith(signedRenewalInfo, environment, (v) => v.verifyAndDecodeRenewalInfo(signedRenewalInfo))
    : null;
  return { notification, transaction, renewal };
}

// ---- 交易 → subscriptions 行（纯函数）----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// App 购买时把 Supabase 用户 ID 作为 appAccountToken 传给苹果，这里据此找回用户。
export function accountTokenUser(transaction) {
  const token = transaction?.appAccountToken;
  return token && UUID.test(token) ? token.toLowerCase() : null;
}

// 一个苹果订阅（original_transaction_id）只能绑定一位用户：
//   已经绑定过 → 归原来的用户；否则 → 归 appAccountToken 对应的用户。
// requestingUserId：App 同步时的当前登录用户。订阅属于别人时返回 conflict，避免一个 Apple ID 的订阅给多个手机号用。
export function resolveOwner({ transaction, boundUserId, requestingUserId }) {
  const tokenUser = accountTokenUser(transaction);
  const owner = boundUserId || tokenUser;
  if (requestingUserId) {
    if (owner && owner !== requestingUserId) return { userId: null, conflict: true };
    return { userId: requestingUserId, conflict: false };
  }
  return { userId: owner, conflict: false };
}

// existing：这位用户 subscriptions 里现有的一行（可能为空）。
// 返回要写入的行；通知比现有记录旧时返回 null（苹果的通知可能乱序到达）。
export function subscriptionRow({ userId, transaction, renewal, notificationType, existing }) {
  if (!transaction?.originalTransactionId || !transaction.expiresDate) return null;
  // 月付升级到年付时，旧的月付交易会被标记 isUpgraded 并带上 revocationDate。
  // 它不是退款，不能据此停用；新的年付交易会另外送来。
  if (transaction.isUpgraded) return null;
  const signedAt = transaction.signedDate ? new Date(transaction.signedDate).toISOString() : null;
  if (
    existing?.source === 'app_store' &&
    existing.original_transaction_id === transaction.originalTransactionId &&
    existing.last_signed_at &&
    signedAt &&
    signedAt < new Date(existing.last_signed_at).toISOString()
  ) {
    return null;
  }
  const revoked = Boolean(transaction.revocationDate) && notificationType !== 'REFUND_REVERSED';
  return {
    user_id: userId,
    plan: transaction.productId || 'pro',
    status: revoked ? 'revoked' : 'active',
    expires_at: new Date(transaction.expiresDate).toISOString(),
    source: 'app_store',
    original_transaction_id: transaction.originalTransactionId,
    environment: transaction.environment || null,
    auto_renew: renewal ? renewal.autoRenewStatus === 1 : existing?.auto_renew ?? null,
    last_signed_at: signedAt,
    note: notificationType ? `苹果通知 ${notificationType}` : 'App 同步',
    updated_at: new Date().toISOString(),
  };
}
