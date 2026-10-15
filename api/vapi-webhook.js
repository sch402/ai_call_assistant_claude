// Vapi 的服务端回调。原型只处理通话结束报告（end-of-call-report），把转写和分析结果写进通话卡片。
import { db } from '../lib/db.js';
import { env } from '../lib/env.js';
import { bodyOf, sendJson, timingSafeEqualString } from '../lib/http.js';
import { findCallSids, pickByCallerAndTime } from '../lib/match.js';
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
    const { data } = await db().from('calls').select('*').in('call_sid', sids).limit(1);
    if (data?.length) {
      row = data[0];
      method = 'call_sid';
    }
  }

  // 2) 备选：来电号码 + 时间窗口
  if (!row && callerNumber) {
    const { data } = await db()
      .from('calls')
      .select('*')
      .is('vapi_call_id', null)
      .order('created_at', { ascending: false })
      .limit(20);
    row = pickByCallerAndTime(data || [], {
      callerMatches: (n) => samePhone(n, callerNumber),
      reportStartedAt: startedAt,
    });
    if (row) method = 'caller_time';
  }

  if (row) {
    await db().from('calls').update({ ...update, match_method: method }).eq('id', row.id);
  } else {
    // 对不上任何来电：单独保存，不归属给机主，便于排查。
    await db().from('calls').insert({
      ...update,
      from_number: callerNumber,
      attributed: false,
      match_method: 'unmatched',
    });
  }

  sendJson(res, 200, { ok: true, matched: method || 'unmatched' });
}
