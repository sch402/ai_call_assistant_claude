// 读取通话卡片。网页面板（DASHBOARD_TOKEN）看全部；App 登录用户只看归属给自己的来电。
import { authenticate } from '../lib/auth.js';
import { db } from '../lib/db.js';
import { sendJson } from '../lib/http.js';
import { env } from '../lib/env.js';
import { summarizeTests } from '../lib/forwarding.js';

const FIELDS = [
  'id',
  'created_at',
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
