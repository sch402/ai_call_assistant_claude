// 网页面板读取通话卡片。需要 DASHBOARD_TOKEN。
import { db } from '../lib/db.js';
import { checkDashboardToken, sendJson } from '../lib/http.js';

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
      .select('created_at,forwarded_from,matched_owner')
      .order('created_at', { ascending: false })
      .limit(5),
    db().from('blocklist').select('number,reason,created_at').order('created_at', { ascending: false }),
  ]);
  const error = calls.error || tests.error || blocked.error;
  if (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { calls: calls.data, forwardTests: tests.data, blocklist: blocked.data });
}
