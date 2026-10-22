// Vapi 的服务端回调：
//   assistant-request   来电接通时，按这位用户的设置（称呼、性别、音色）返回助理配置
//   end-of-call-report  通话结束报告，把转写和分析结果写进通话卡片
import { db, logDbError } from '../lib/db.js';
import { env } from '../lib/env.js';
import { bodyOf, sendJson, timingSafeEqualString } from '../lib/http.js';
import { findCallSids, findHeaderValue, pickByCallerAndTime } from '../lib/match.js';
import { assistantForProfile, PROFILE_FIELDS } from '../lib/profile.js';
import { samePhone } from '../lib/phone.js';

function authorized(req) {
  const secret = env('VAPI_WEBHOOK_SECRET');
  const header = req.headers['x-vapi-secret'] || '';
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return timingSafeEqualString(header, secret) || timingSafeEqualString(bearer, secret);
}

// 不同版本的 Vapi 报告里，分析结果可能在 message.analysis 或 message.call.analysis 下。
function analysisOf(message) {
  return message.analysis || message.call?.analysis || {};
}

function durationOf(message) {
  if (typeof message.durationSeconds === 'number') return message.durationSeconds;
  const start = message.startedAt || message.call?.startedAt;
  const end = message.endedAt || message.call?.endedAt;
  if (start && end) return (new Date(end) - new Date(start)) / 1000;
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 找出这通电话属于哪位用户：优先用 /api/twilio-voice 通过 SIP 头带来的用户 ID，
// 其次用 CallSid 查通话记录。Vapi 只给约 7.5 秒，所以查询出错或找不到时直接用默认设置，绝不让电话失败。
async function assistantFor(message) {
  try {
    let userId = findHeaderValue(message, 'x-user_id');
    if (!userId) {
      const sids = findCallSids(message);
      if (sids.length) {
        const call = await db().from('calls').select('user_id').in('call_sid', sids).limit(1);
        logDbError('calls.select for assistant-request', call);
        userId = call.data?.[0]?.user_id || null;
      }
    }
    if (userId && UUID.test(userId)) {
      const profile = await db().from('profiles').select(PROFILE_FIELDS).eq('user_id', userId).maybeSingle();
      if (!logDbError('profiles.select for assistant-request', profile)) return assistantForProfile(profile.data);
    }
  } catch (err) {
    console.error('assistant-request 查询用户设置失败', err.message);
  }
  return assistantForProfile(null);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const message = bodyOf(req).message || {};
  if (message.type === 'assistant-request') {
    sendJson(res, 200, { assistant: await assistantFor(message) });
    return;
  }
  if (message.type !== 'end-of-call-report') {
    sendJson(res, 200, { ok: true, ignored: message.type || null });
    return;
  }

  const analysis = analysisOf(message);
  const artifact = message.artifact || {};
  const vapiCallId = message.call?.id || null;
  const callerNumber = message.call?.customer?.number || message.customer?.number || null;
  const startedAt = message.startedAt || message.call?.startedAt || null;

  const update = {
    vapi_call_id: vapiCallId,
    status: 'completed',
    ended_reason: message.endedReason || null,
    duration_seconds: durationOf(message),
    summary: analysis.summary || null,
    structured: analysis.structuredData || null,
    transcript: artifact.transcript || message.transcript || null,
    messages: artifact.messages || message.messages || null,
    raw_report: message,
  };

  // 1) 用 SIP 头带过去的 CallSid 精确匹配
  let row = null;
  let method = null;
  const sids = findCallSids(message);
  if (sids.length) {
    const found = await db().from('calls').select('*').in('call_sid', sids).limit(1);
    logDbError('calls.select by call_sid', found);
    const data = found.data;
    if (data?.length) {
      row = data[0];
      method = 'call_sid';
    }
  }

  // 2) 备选：来电号码 + 时间窗口
  if (!row && callerNumber) {
    const recent = await db()
      .from('calls')
      .select('*')
      .is('vapi_call_id', null)
      .order('created_at', { ascending: false })
      .limit(20);
    logDbError('calls.select recent', recent);
    const data = recent.data;
    row = pickByCallerAndTime(data || [], {
      callerMatches: (n) => samePhone(n, callerNumber),
      reportStartedAt: startedAt,
    });
    if (row) method = 'caller_time';
  }

  const written = row
    ? await db().from('calls').update({ ...update, match_method: method }).eq('id', row.id)
    : // 对不上任何来电：单独保存，不归属给任何用户，便于排查。
      await db().from('calls').insert({
        ...update,
        from_number: callerNumber,
        attributed: false,
        match_method: 'unmatched',
      });
  const writeError = logDbError(row ? 'calls.update report' : 'calls.insert unmatched report', written);
  if (writeError) {
    sendJson(res, 500, { error: writeError.message || 'database error' });
    return;
  }

  sendJson(res, 200, { ok: true, matched: method || 'unmatched' });
}
