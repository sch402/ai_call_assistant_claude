// 推送通知：AI 接完一通电话后，把「谁打来的 + 摘要」推到用户的 iPhone。
// 直接用 Node 自带的 http2 调 Apple Push Notification service（APNs），不依赖第三方库。
// 鉴权用 APNs Auth Key（.p8）签 ES256 令牌：Apple Developer › Certificates, Identifiers & Profiles › Keys。
// 没配置 APNS_KEY_ID / APNS_PRIVATE_KEY 时推送自动关闭，不影响其他功能。
import { createPrivateKey, sign } from 'node:crypto';
import http2 from 'node:http2';
import { db, logDbError } from './db.js';
import { env } from './env.js';

const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com',
};
export const PUSH_ENVIRONMENTS = Object.keys(HOSTS);
const TOKEN_TTL_MS = 50 * 60 * 1000; // 苹果要求 20–60 分钟内换一次令牌
const SEND_TIMEOUT_MS = 8000;
const BODY_MAX = 180;

export function pushEnabled() {
  return Boolean(process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY);
}

// iPhone 上报的 deviceToken：64 位十六进制（以后可能变长，所以只限制范围）
export function validPushToken(token) {
  return typeof token === 'string' && /^[0-9a-f]{64,200}$/i.test(token);
}

// .p8 文件内容。Vercel 里粘贴时换行可能变成字面的 \n，或者只粘了中间那段 base64，这里都兼容。
export function normalizePrivateKey(value) {
  let text = String(value).trim().replace(/\\n/g, '\n');
  if (!text.includes('BEGIN PRIVATE KEY')) {
    const body = text.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? '';
    text = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
  }
  return text;
}

const base64url = (input) => Buffer.from(input).toString('base64url');

export function providerToken({ keyId, teamId, privateKey, now = Date.now() }) {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: createPrivateKey(normalizePrivateKey(privateKey)),
    dsaEncoding: 'ieee-p1363', // JWT 要的是 r||s 拼接，不是 DER
  });
  return `${header}.${claims}.${signature.toString('base64url')}`;
}

let cachedToken = null;
function currentProviderToken() {
  const now = Date.now();
  if (!cachedToken || now - cachedToken.at > TOKEN_TTL_MS) {
    cachedToken = {
      at: now,
      value: providerToken({
        keyId: env('APNS_KEY_ID'),
        teamId: env('APNS_TEAM_ID', '3YDFH675B7'),
        privateKey: env('APNS_PRIVATE_KEY'),
        now,
      }),
    };
  }
  return cachedToken.value;
}

// +61412345678 → +61 412 345 678（和 App 里的 PhoneFormat 一致）
export function displayNumber(number) {
  const d = String(number || '').replace(/\D/g, '');
  if (!String(number).startsWith('+61') || d.length !== 11) return number || '';
  const s = d.slice(2);
  return s[0] === '4' ? `+61 ${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}` : `+61 ${s[0]} ${s.slice(1, 5)} ${s.slice(5)}`;
}

const NUISANCE = new Set(['scam', 'telemarketing', 'robocall']);
const meaningful = (v) => typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'unknown';

// 通话报告 → 通知内容。标题和 App 列表一致：对方自称的名字和机构，没有就用号码。
// 疑似诈骗在标题前标出来；骚扰类来电用 passive 级别，静默进通知中心，不响铃、不亮屏。
export function callNotification({ callId, fromNumber, structured, summary }) {
  const s = structured || {};
  const who = [s.caller_name, s.organization].filter(meaningful).map((v) => v.trim()).join(' · ');
  const scam = Number(s.scam_risk) >= 70 || s.category === 'scam';
  const name = who || displayNumber(fromNumber) || '未知来电';
  const title = scam ? `疑似诈骗 · ${name}` : name;
  let body = (meaningful(s.summary_zh) ? s.summary_zh : summary || '').trim() || 'AI 已接听，点开查看详情。';
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1)}…`;
  const nuisance = scam || NUISANCE.has(s.category);
  return {
    aps: {
      alert: { title, body },
      sound: nuisance ? undefined : 'default',
      'thread-id': 'calls',
      'interruption-level': nuisance ? 'passive' : 'active',
    },
    callId,
  };
}

// 发给一个环境下的一组设备。返回每个设备的结果 { token, status, reason }。
function sendBatch(environment, tokens, payload, headers) {
  return new Promise((resolve) => {
    const results = [];
    const client = http2.connect(HOSTS[environment]);
    const finish = () => {
      clearTimeout(timer);
      client.close();
      resolve(results);
    };
    const timer = setTimeout(() => {
      client.destroy();
      resolve(results);
    }, SEND_TIMEOUT_MS);
    client.on('error', (err) => {
      console.error('APNs 连接失败', environment, err.message);
      finish();
    });
    let pending = tokens.length;
    for (const token of tokens) {
      const req = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, ...headers });
      let status = 0;
      let data = '';
      req.setEncoding('utf8');
      req.on('response', (h) => (status = h[':status']));
      req.on('data', (chunk) => (data += chunk));
      let settled = false;
      const done = () => {
        if (settled) return; // 出错后可能还会收到 end
        settled = true;
        let reason = null;
        try {
          reason = data ? JSON.parse(data).reason : null;
        } catch {}
        results.push({ token, status, reason });
        if (--pending === 0) finish();
      };
      req.on('end', done);
      req.on('error', (err) => {
        data = JSON.stringify({ reason: err.message });
        done();
      });
      req.end(JSON.stringify(payload));
    }
  });
}

// 设备已卸载 App、换了环境或令牌无效：删掉，下次 App 启动会重新上报
export function isDeadToken({ status, reason }) {
  return status === 410 || ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(reason);
}

// 通话报告写入后调用。出错只记日志，不影响通话记录的保存。
export async function notifyCallCompleted({ userId, callId, fromNumber, structured, summary }) {
  if (!userId || !pushEnabled()) return;
  try {
    const rows = await db().from('push_tokens').select('token, environment').eq('user_id', userId);
    if (logDbError('push_tokens.select', rows) || !rows.data?.length) return;

    const payload = callNotification({ callId, fromNumber, structured, summary });
    const headers = {
      authorization: `bearer ${currentProviderToken()}`,
      'apns-topic': env('APNS_BUNDLE_ID', env('APPLE_BUNDLE_ID', 'com.homeau.callassistant')),
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 24 * 3600),
      ...(callId ? { 'apns-collapse-id': String(callId).slice(0, 64) } : {}),
    };
    const results = [];
    for (const environment of PUSH_ENVIRONMENTS) {
      const tokens = rows.data.filter((r) => r.environment === environment).map((r) => r.token);
      if (tokens.length) results.push(...(await sendBatch(environment, tokens, payload, headers)));
    }

    const dead = results.filter(isDeadToken).map((r) => r.token);
    if (dead.length) logDbError('push_tokens.delete dead', await db().from('push_tokens').delete().in('token', dead));
    const failed = results.filter((r) => r.status !== 200 && !isDeadToken(r));
    if (failed.some((r) => r.status === 403)) console.error('APNs 拒绝了令牌：检查 APNS_KEY_ID、APNS_TEAM_ID、APNS_PRIVATE_KEY');
    console.log('推送通知', JSON.stringify({
      devices: results.length,
      sent: results.filter((r) => r.status === 200).length,
      removed: dead.length,
      failed: failed.map((r) => `${r.status} ${r.reason || ''}`.trim()),
    }));
  } catch (err) {
    console.error('推送通知失败', err.message);
  }
}

// App 上报或注销设备（POST /api/account）。同一台设备换了登录账号时，归到新账号下。
export async function registerPushToken(userId, { token, environment }) {
  if (!validPushToken(token)) return { error: '设备令牌格式不对' };
  if (!PUSH_ENVIRONMENTS.includes(environment)) return { error: 'environment 只能是 production 或 sandbox' };
  const saved = await db()
    .from('push_tokens')
    .upsert({ token: token.toLowerCase(), user_id: userId, environment, updated_at: new Date().toISOString() }, { onConflict: 'token' });
  if (logDbError('push_tokens.upsert', saved)) return { error: '保存失败，请稍后再试' };
  return {};
}

export async function unregisterPushToken(userId, token) {
  if (!validPushToken(token)) return { error: '设备令牌格式不对' };
  const removed = await db().from('push_tokens').delete().eq('token', token.toLowerCase()).eq('user_id', userId);
  if (logDbError('push_tokens.delete', removed)) return { error: '删除失败，请稍后再试' };
  return {};
}
