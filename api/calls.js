// 网页面板读取通话卡片。需要 DASHBOARD_TOKEN。
import { db } from '../lib/db.js';
import { checkDashboardToken, sendJson } from '../lib/http.js';
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
  if (!checkDashboardToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
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
  const forwardTests = summarizeTests(tests.data || [], {
    ourNumber: env('TWILIO_PHONE_NUMBER'),
    ownerNumber: env('OWNER_PHONE_NUMBER'),
  });
  sendJson(res, 200, { calls: calls.data, forwardTests, blocklist: blocked.data });
}
