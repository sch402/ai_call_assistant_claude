// 陌生号码分析：在公开网页里查这个号码可能属于谁（例如「Charles Adam · 房产中介 · Ray White」）。
//
// 低成本、宁缺毋滥：
//   1. 用 Brave Search 一次搜索号码的几种常见写法（0401 234 505、0401234505、+61 401 234 505…）
//   2. 代码逐条确认搜索结果里真的出现了这个号码；一条都没有就直接返回 null，不调用模型、不花钱
//   3. 只把确认含有号码的结果交给小模型（默认 Claude Haiku 5.5）提取「谁、做什么、哪家公司」，
//      要求证据明确才算找到；再在代码里核对置信度和引用来源，不满足就当没找到
// 结果按号码缓存（number_lookups 表），找到的 30 天、没找到的 7 天内不重复搜索。
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from './env.js';
import { digits } from './phone.js';

export const MIN_CONFIDENCE = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
export const CACHE_DAYS = { found: 30, notFound: 7 };

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

export function searchQuery(e164) {
  return numberVariants(e164).map((v) => `"${v}"`).join(' OR ');
}

// 网页文字里像电话号码的片段，例如 "0401 234 505"、"+61 (0)401-234-505"、"(02) 5849 6666"
const PHONE_LIKE = /\+?\(?\d[\d\s().-]{6,20}\d/g;

// 这段文字里是否出现了这个号码（任何常见写法）。逐个号码片段比对，避免把相邻的数字拼在一起误判。
export function textMentionsNumber(text, e164) {
  const target = nationalDigits(e164);
  if (target.length < 8) return false;
  for (const match of String(text || '').match(PHONE_LIKE) || []) {
    let d = digits(match);
    if (d.startsWith('0061')) d = d.slice(2); // 0061 401 … → 61 401 …
    if (d.startsWith('610')) d = d.slice(3); // +61 (0) 401 …
    else if (d.startsWith('61')) d = d.slice(2);
    else if (d.startsWith('0')) d = d.slice(1);
    if (d === target) return true;
  }
  return false;
}

// 只保留确实出现了这个号码的搜索结果
export function matchingResults(results, e164) {
  return (results || []).filter((r) =>
    textMentionsNumber([r.title, r.description, ...(r.extra_snippets || [])].join('\n'), e164)
  );
}

// ---- 外部服务 ----

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
  return Boolean(process.env.BRAVE_SEARCH_API_KEY && process.env.ANTHROPIC_API_KEY);
}

// 完整流程。返回结果对象或 null（没找到、没配置、或出错都返回 null，不影响来电详情页）。
export async function lookupNumber(e164) {
  const matches = matchingResults(await braveSearch(searchQuery(e164)), e164);
  if (!matches.length) return null;
  return acceptIdentity(await extractIdentity(matches, e164), matches);
}
