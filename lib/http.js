import { env } from './env.js';

export function sendXml(res, xml) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.status(200).send(xml);
}

export function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

// 网页面板和管理接口共用的访问口令。用常数时间比较，避免时序攻击。
export function checkDashboardToken(req) {
  const expected = env('DASHBOARD_TOKEN');
  const header = req.headers.authorization || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  return timingSafeEqualString(provided, expected);
}

export function timingSafeEqualString(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  let diff = sa.length ^ sb.length;
  const len = Math.max(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    diff |= (sa.charCodeAt(i) || 0) ^ (sb.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// Vercel 会自动解析 JSON 和 urlencoded 请求体；这里兜底处理字符串的情况。
export function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return Object.fromEntries(new URLSearchParams(req.body));
    }
  }
  return req.body;
}
