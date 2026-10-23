// 陌生号码分析：在公开网页里查这个号码可能属于谁（例如「Charles Adam · 房产中介 · Ray White」）。
//
// 低成本、宁缺毋滥：
//   1. 一次搜索号码的几种常见写法（0401 234 505、0401234505、+61 401 234 505…）。
//      搜索服务优先用 Serper（Google 结果，约 $0.30–1 / 千次），没配置时用 Brave（约 $5 / 千次）
//   2. 代码逐条确认搜索结果里真的出现了这个号码；摘要里都没有时，打开前 3 个网页在正文里找（不花 API 费用）。
//      还是没有就直接返回 null，不调用模型
//   3. 只把确认含有号码的结果交给小模型（默认 Claude Haiku 5.5）提取「谁、做什么、哪家公司」，
//      要求证据明确才算找到；再在代码里核对置信度和引用来源，不满足就当没找到
// 结果按号码缓存（number_lookups 表），找到的 90 天、没找到的 30 天内不重复搜索；每位用户每天最多 20 次新查询。
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from './env.js';
import { digits } from './phone.js';

export const MIN_CONFIDENCE = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
// 号码归属很少变化，缓存久一些能省掉大部分搜索费
export const CACHE_DAYS = { found: 90, notFound: 30 };
// 每位用户每天最多触发多少次新搜索（命中缓存不算），防止个别账号刷高费用
export const MAX_NEW_LOOKUPS_PER_DAY = 20;

// ---- 号码写法 ----

// 号码去掉国家码后的部分，用来在网页文字里比对。澳洲号码是 9 位（4xx xxx xxx、2 xxxx xxxx）。
export function nationalDigits(e164) {
  const d = digits(e164);
  if (d.startsWith('61') && d.length === 11) return d.slice(2);
  return d.length > 9 ? d.slice(-9) : d;
}

// 搜索用的几种常见写法
export function numberVariants(e164) {
  const d = digits(e164);
  if (d.startsWith('61') && d.length === 11) {
    const n = d.slice(2);
    if (n.startsWith('4')) {
      const [a, b, c] = [n.slice(0, 3), n.slice(3, 6), n.slice(6)];
      return [`0${a} ${b} ${c}`, `0${n}`, `+61 ${a} ${b} ${c}`, `+61${n}`];
    }
    const [area, a, b] = [n.slice(0, 1), n.slice(1, 5), n.slice(5)];
    return [`(0${area}) ${a} ${b}`, `0${area} ${a} ${b}`, `0${n}`, `+61 ${area} ${a} ${b}`];
  }
  return [`+${d}`, d];
}

// 第一项不加引号（和在 Google 里直接搜 0436803229 一样，Google 会自己匹配其他写法），
// 后面加上带空格和带 +61 的写法作补充。
export function searchQuery(e164) {
  const variants = numberVariants(e164);
  const compact = variants.find((v) => /^0\d+$/.test(v)) || variants[0];
  const others = variants.filter((v) => v !== compact && !/^\+\d+$/.test(v)).slice(0, 2);
  return [compact, ...others.map((v) => `"${v}"`)].join(' OR ');
}

// 网页文字里像电话号码的片段，例如 "0401 234 505"、"+61 (0)401-234-505"、"(02) 5849 6666"
const PHONE_LIKE = /\+?\(?\d[\d\s().-]{6,20}\d/g;

// 号码在这段文字里第一次出现的位置（任何常见写法），没有返回 -1。
// 逐个号码片段比对，避免把相邻的数字拼在一起误判。
export function findNumber(text, e164) {
  const target = nationalDigits(e164);
  if (target.length < 8) return -1;
  const pattern = new RegExp(PHONE_LIKE.source, 'g');
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    let d = digits(match[0]);
    if (d.startsWith('0061')) d = d.slice(2); // 0061 401 … → 61 401 …
    if (d.startsWith('610')) d = d.slice(3); // +61 (0) 401 …
    else if (d.startsWith('61')) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
    if (d === target) return match.index;
  }
  return -1;
}

export function textMentionsNumber(text, e164) {
  return findNumber(text, e164) >= 0;
}

// 号码前后各一段文字，作为交给模型的证据
export function excerptAroundNumber(text, e164, radius = 300) {
  const index = findNumber(text, e164);
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, index + radius).trim()}…`;
}

// 网页 HTML → 纯文字。tel: 链接里的号码也保留（很多页面只在链接里写号码）。
export function htmlToText(html) {
  const tels = [...String(html).matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1]));
  const text = String(html)
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return tels.length ? `${text} Phone: ${tels.join(' , ')}` : text;
}

// 只保留确实出现了这个号码的搜索结果
export function matchingResults(results, e164) {
  return (results || []).filter((r) =>
    textMentionsNumber([r.title, r.description, ...(r.extra_snippets || [])].join('\n'), e164)
  );
}

// ---- 外部服务 ----

// Serper：Google 搜索结果。https://serper.dev
async function serperSearch(query) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': env('SERPER_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'au', num: 10 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data = await res.json();
  return (data.organic || []).map((r) => ({
    title: r.title || '',
    url: r.link || '',
    description: r.snippet || '',
    extra_snippets: [],
  }));
}

function searchWeb(query) {
  return process.env.SERPER_API_KEY ? serperSearch(query) : braveSearch(query);
}

async function braveSearch(query) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '10');
  url.searchParams.set('country', 'AU');
  url.searchParams.set('extra_snippets', 'true');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': env('BRAVE_SEARCH_API_KEY') },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Brave Search ${res.status}`);
  const data = await res.json();
  return (data.web?.results || []).map((r) => ({
    title: r.title || '',
    url: r.url || '',
    description: r.description || '',
    extra_snippets: r.extra_snippets || [],
  }));
}

const Identity = z.object({
  found: z.boolean(),
  kind: z.enum(['person', 'business', 'spam_report', 'unknown']),
  name: z.string(),
  role_zh: z.string(),
  organization: z.string(),
  confidence: z.number().int(),
  evidence_urls: z.array(z.string()),
});

const SYSTEM = `You identify who owns a phone number, using only the web search results provided. Every result has already been checked to contain the number.

Report an identity only when a result explicitly ties THIS number to a specific person or business: an agent or staff profile, a business listing or contact page, a classified ad, or a caller-ID / spam-report site. Never infer from names that merely appear on the same page. If the results disagree, or nothing ties the number to anyone, set found=false and leave the text fields empty.

Fields:
- kind: "person" (a named individual, e.g. a real estate agent), "business", "spam_report" (report sites say it is telemarketing, scam or robocall), or "unknown".
- name: the person's or business's name exactly as written in the results. Empty for spam_report.
- role_zh: a short role in Simplified Chinese, e.g. "房产中介", "牙科诊所", "物流公司", "被举报为推销电话". Empty if unclear.
- organization: the company the person works for, exactly as written; empty if none or if kind is "business".
- confidence: 0-100. One authoritative listing ≈ 75-85; several independent, consistent sources ≈ 90+; weak or indirect evidence < 60.
- evidence_urls: URLs of the results you relied on, copied exactly.`;

async function extractIdentity(matches, e164) {
  const client = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  const results = matches
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${[r.description, ...r.extra_snippets].join('\n')}`)
    .join('\n\n');
  const response = await client.messages.parse({
    model: env('LOOKUP_MODEL', 'claude-haiku-5-5'),
    max_tokens: 1024,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(Identity) },
    messages: [{ role: 'user', content: `Phone number: ${numberVariants(e164).join(' / ')}\n\nSearch results:\n\n${results}` }],
  });
  if (response.stop_reason === 'refusal') return null;
  return response.parsed_output ?? null;
}

// ---- 结果判定（纯函数）----

// 模型输出 → 返回给 App 的结果；证据不足时返回 null。
// 要求：found、置信度达标、有名字或角色，且引用的来源确实在含有号码的结果里（防止模型编造）。
export function acceptIdentity(identity, matches) {
  if (!identity?.found || identity.kind === 'unknown') return null;
  const confidence = Math.max(0, Math.min(100, Math.round(identity.confidence)));
  if (confidence < MIN_CONFIDENCE) return null;
  const allowed = new Set(matches.map((r) => r.url));
  const sources = (identity.evidence_urls || []).filter((u) => allowed.has(u));
  if (!sources.length) return null;
  const name = identity.kind === 'spam_report' ? '' : identity.name.trim();
  const role = identity.role_zh.trim();
  if (!name && !role) return null;
  return {
    kind: identity.kind,
    name: name || null,
    role: role || null,
    organization: identity.kind === 'person' ? identity.organization.trim() || null : null,
    confidence,
    sources: sources.slice(0, 3),
  };
}

// 缓存是否还有效
export function cacheFresh(row, now = Date.now()) {
  if (!row?.searched_at) return false;
  const days = row.result ? CACHE_DAYS.found : CACHE_DAYS.notFound;
  return now - new Date(row.searched_at).getTime() < days * DAY_MS;
}

export function lookupEnabled() {
  const search = process.env.SERPER_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  return Boolean(search && process.env.ANTHROPIC_API_KEY);
}

// 完整流程。返回结果对象或 null（没找到、没配置、或出错都返回 null，不影响来电详情页）。
// 打开网页，在正文里找号码。搜索摘要没截到号码时用（Google 能搜到，说明页面里通常有）。
// 不花 API 费用；打不开、太慢或没有号码都返回 null。
const PAGES_TO_OPEN = 3;

async function pageExcerpt(url, e164) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CallAssistantBot/1.0)', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('html')) return null;
    const html = (await res.text()).slice(0, 800_000);
    return excerptAroundNumber(htmlToText(html), e164);
  } catch {
    return null;
  }
}

// 日志里的号码打码：+61436***229
function maskNumber(e164) {
  return e164.length > 8 ? `${e164.slice(0, 6)}***${e164.slice(-3)}` : '***';
}

export async function lookupNumber(e164) {
  const results = await searchWeb(searchQuery(e164));
  let matches = matchingResults(results, e164);
  let opened = 0;
  if (!matches.length && results.length) {
    const candidates = results.slice(0, PAGES_TO_OPEN);
    opened = candidates.length;
    const excerpts = await Promise.all(candidates.map((r) => pageExcerpt(r.url, e164)));
    matches = candidates
      .map((r, i) => (excerpts[i] ? { ...r, extra_snippets: [...r.extra_snippets, excerpts[i]] } : null))
      .filter(Boolean);
  }
  const log = { number: maskNumber(e164), results: results.length, matched: matches.length, opened };
  if (!matches.length) {
    console.log('号码分析：没有含号码的结果', JSON.stringify(log));
    return null;
  }
  const identity = await extractIdentity(matches, e164);
  const accepted = acceptIdentity(identity, matches);
  console.log('号码分析', JSON.stringify({
    ...log,
    found: identity?.found ?? null,
    kind: identity?.kind ?? null,
    confidence: identity?.confidence ?? null,
    accepted: Boolean(accepted),
  }));
  return accepted;
}
