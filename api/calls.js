// 读取通话卡片。网页面板（DASHBOARD_TOKEN）看全部；App 登录用户只看归属给自己的来电。
// GET /api/calls?lookup=+61…：陌生号码分析（lib/lookup.js），只能查打给自己的号码。
import { authenticate } from '../lib/auth.js';
import { db, logDbError } from '../lib/db.js';
import { cacheFresh, lookupEnabled, lookupNumber } from '../lib/lookup.js';
import { sendJson } from '../lib/http.js';
import { env } from '../lib/env.js';
import { summarizeTests } from '../lib/forwarding.js';

const FIELDS = [
  'id',
  'created_at',
  'user_id',
  'call_sid',
  'from_number',
  'forwarded_from',
  'attributed',
  'stir_verstat',
  'caller_country',
  'status',
  'match_method',
  'ended_reason',
  'duration_seconds',
  'summary',
  'structured',
  'transcript',
].join(',');

export default async function handler(req, res) {
  const auth = await authenticate(req);
  if (!auth) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  if (auth.user && req.query?.lookup) {
    sendJson(res, 200, { lookup: await lookupForUser(auth.user.id, String(req.query.lookup)) });
    return;
  }
  if (auth.user) {
    const mine = await db()
      .from('calls')
      .select(FIELDS)
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (mine.error) {
      sendJson(res, 500, { error: mine.error.message || 'database error' });
      return;
    }
    sendJson(res, 200, { calls: mine.data });
    return;
  }

  const [calls, tests, blocked] = await Promise.all([
    db().from('calls').select(FIELDS).order('created_at', { ascending: false }).limit(50),
    db()
      .from('forward_tests')
      .select('created_at,forwarded_from,matched_owner,raw_params')
      .order('created_at', { ascending: false })
      .limit(20),
    db().from('blocklist').select('number,reason,created_at').order('created_at', { ascending: false }),
  ]);
  const error = calls.error || tests.error || blocked.error;
  if (error) {
    const hint = /invalid path/i.test(error.message || '')
      ? '（请检查 Vercel 里的 SUPABASE_URL：只填 https://xxxx.supabase.co，不要带 /rest/v1 等路径）'
      : '';
    sendJson(res, 500, { error: (error.message || 'database error') + hint });
    return;
  }
  const forwardTests = summarizeTests(tests.data || [], { ourNumber: env('TWILIO_PHONE_NUMBER') });
  sendJson(res, 200, { calls: calls.data, forwardTests, blocklist: blocked.data });
}

// 陌生号码分析。任何失败都返回 null：详情页什么都不显示，和没找到一样。
async function lookupForUser(userId, number) {
  if (!lookupEnabled() || !/^\+\d{8,15}$/.test(number)) return null;
  // 只允许查打给自己的号码，避免被当成免费的反查工具
  const own = await db().from('calls').select('id').eq('user_id', userId).eq('from_number', number).limit(1);
  if (logDbError('calls.select for lookup', own) || !own.data?.length) return null;

  const cached = await db().from('number_lookups').select('result,searched_at').eq('number', number).maybeSingle();
  logDbError('number_lookups.select', cached);
  if (cacheFresh(cached.data)) return cached.data.result;

  try {
    const result = await lookupNumber(number);
    logDbError(
      'number_lookups.upsert',
      await db()
        .from('number_lookups')
        .upsert({ number, result, searched_at: new Date().toISOString() }, { onConflict: 'number' })
    );
    return result;
  } catch (err) {
    console.error('号码分析失败', err.message);
    return null;
  }
}
