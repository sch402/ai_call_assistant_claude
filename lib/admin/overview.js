// 后台概览（GET /api/admin/overview，需要 DASHBOARD_TOKEN）：用户、订阅和最近 30 天的通话统计。
import { db, logDbError } from '../db.js';
import { entitlementOf } from '../entitlement.js';
import { checkDashboardToken, sendJson } from '../http.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const REJECTED = new Set(['unpaid', 'rejected', 'blocked']);

// 纯函数：把三张表的数据整理成后台要显示的样子。
export function buildOverview({ profiles = [], subscriptions = [], calls = [], now = Date.now() }) {
  const subByUser = new Map(subscriptions.map((s) => [s.user_id, s]));
  const phoneByUser = new Map(profiles.map((p) => [p.user_id, p.phone]));
  const callsByUser = new Map();
  for (const c of calls) {
    if (!c.user_id) continue;
    const list = callsByUser.get(c.user_id) || [];
    list.push(c);
    callsByUser.set(c.user_id, list);
  }
  const within = (iso, days) => now - new Date(iso).getTime() <= days * DAY_MS;

  const users = profiles.map((p) => {
    const sub = subByUser.get(p.user_id) || null;
    const mine = callsByUser.get(p.user_id) || [];
    const last = mine.reduce((a, c) => (!a || c.created_at > a ? c.created_at : a), null);
    return {
      user_id: p.user_id,
      phone: p.phone,
      name: p.display_name || null,
      gender: p.gender || null,
      voice_style: p.voice_style || null,
      created_at: p.created_at,
      subscription: entitlementOf(sub, { now }).state,
      plan: sub?.plan || null,
      calls_30d: mine.length,
      rejected_30d: mine.filter((c) => REJECTED.has(c.status)).length,
      last_call_at: last,
    };
  });

  const subs = subscriptions
    .map((s) => ({
      ...s,
      phone: phoneByUser.get(s.user_id) || null,
      state: entitlementOf(s, { now }).state,
    }))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  const stats = {
    users: profiles.length,
    new_users_7d: profiles.filter((p) => p.created_at && within(p.created_at, 7)).length,
    onboarded: profiles.filter((p) => p.display_name && p.gender).length,
    paying: users.filter((u) => u.subscription === 'active' || u.subscription === 'grace').length,
    calls_7d: calls.filter((c) => within(c.created_at, 7)).length,
    calls_30d: calls.length,
    rejected_30d: calls.filter((c) => REJECTED.has(c.status)).length,
  };
  return { stats, users, subscriptions: subs };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  if (!checkDashboardToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const [profiles, subscriptions, calls] = await Promise.all([
    db()
      .from('profiles')
      .select('user_id,phone,display_name,gender,voice_style,created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    db()
      .from('subscriptions')
      .select('user_id,plan,status,expires_at,source,environment,auto_renew,note,updated_at')
      .limit(1000),
    db().from('calls').select('user_id,status,created_at').gte('created_at', since).limit(10000),
  ]);
  const error =
    logDbError('overview profiles', profiles) ||
    logDbError('overview subscriptions', subscriptions) ||
    logDbError('overview calls', calls);
  if (error) {
    sendJson(res, 500, { error: error.message || 'database error' });
    return;
  }
  sendJson(res, 200, buildOverview({ profiles: profiles.data, subscriptions: subscriptions.data, calls: calls.data }));
}
