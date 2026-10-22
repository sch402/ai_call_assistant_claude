// 订阅状态判定（纯函数，便于单元测试）。
//
// subscriptions 表每位用户一行：
//   expires_at 为空 = 不过期（例如运营者自己、或手动开通的长期账户）
//   status = 'revoked' 表示退款或人工停用，立即失效，没有宽限期
// 到期后有 GRACE_DAYS 天宽限期：照常接听，App 里提示续费。宽限期过后来电直接拒接。
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// 返回 { state, expiresAt, graceEndsAt }，state 为：
//   active  订阅有效
//   grace   已到期，宽限期内，照常接听
//   expired 宽限期已过或已停用，来电拒接
//   none    从没开通过，来电拒接
export function entitlementOf(subscription, { now = Date.now() } = {}) {
  if (!subscription) return { state: 'none', expiresAt: null, graceEndsAt: null };
  if (subscription.status === 'revoked') {
    return { state: 'expired', expiresAt: subscription.expires_at || null, graceEndsAt: null };
  }
  if (!subscription.expires_at) return { state: 'active', expiresAt: null, graceEndsAt: null };

  const expires = new Date(subscription.expires_at).getTime();
  if (Number.isNaN(expires)) return { state: 'expired', expiresAt: null, graceEndsAt: null };
  const graceEnds = expires + GRACE_DAYS * DAY_MS;
  const result = { expiresAt: new Date(expires).toISOString(), graceEndsAt: new Date(graceEnds).toISOString() };
  if (now < expires) return { state: 'active', ...result };
  if (now < graceEnds) return { state: 'grace', ...result };
  return { state: 'expired', ...result };
}

export function canAnswer(entitlement) {
  return entitlement.state === 'active' || entitlement.state === 'grace';
}

// 一通打到公用号码的来电怎么处理。
//   userId      按转移来源在 profiles 里找到的用户（可能为空）
//   hasForwardedFrom  运营商是否带了能补全的转移来源
//   acceptUnattributed  是否接听无法归属的来电（ACCEPT_UNATTRIBUTED_CALLS，原型兼容用，默认否）
// 返回 { answer: boolean, status, reason }，status 写进 calls.status。
export function decideCall({ userId, entitlement, hasForwardedFrom, acceptUnattributed = false }) {
  if (userId) {
    if (canAnswer(entitlement)) return { answer: true, status: 'answering', reason: entitlement.state };
    return { answer: false, status: 'unpaid', reason: entitlement.state };
  }
  // 公用号码上分不清是谁转过来的（没带转移来源、账户已删除、从没注册，或者直接拨打这个号码），一律不接。
  if (acceptUnattributed) return { answer: true, status: 'answering', reason: 'unattributed' };
  return { answer: false, status: 'rejected', reason: hasForwardedFrom ? 'unknown_user' : 'no_forwarded_from' };
}
