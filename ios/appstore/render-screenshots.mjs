// 生成 App Store 截图：用 HTML 按 SwiftUI 界面原样复刻 App 的各个页面（数据来自 demo-data.mjs），
// 配上标题，用 Playwright 渲染成苹果要求的尺寸，输出到 fastlane/screenshots/<语言>/。
//   node ios/appstore/render-screenshots.mjs            全部截图 + 搜索结果预览
//   node ios/appstore/render-screenshots.mjs --html     只输出 HTML（ios/appstore/build/），方便在浏览器里调样式
// 需要 Playwright（云端环境自带；本机 npm i -D playwright && npx playwright install chromium）。
// 中文字体用 Noto Sans SC（与苹方接近），没装时会退回系统字体。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DEMO_CALLS, DEMO_PROFILE } from './demo-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fastlane', 'screenshots');
const BUILD = join(HERE, 'build');
const ICON_PNG = join(HERE, '..', 'CallAssistant', 'Resources', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-1024.png');

// 苹果要求的截图尺寸（竖屏）。只传 6.9 英寸也可以，苹果会自动缩放给其他机型；6.5 英寸给旧版 App Store Connect 流程备用。
export const SIZES = [
  { id: '6.9', width: 1320, height: 2868 },
  { id: '6.5', width: 1284, height: 2778 },
];
const SCALE = 3; // CSS 像素 × 3 = 实际像素

// ---------- 图标（Phosphor Icons，MIT，见 icons/LICENSE；形状接近 SF Symbols） ----------
const ICONS = Object.fromEntries(
  readdirSync(join(HERE, 'icons'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => [f.replace('.svg', ''), readFileSync(join(HERE, 'icons', f), 'utf8')]),
);
const icon = (name, cls = '') => ICONS[name].replace('<svg ', `<svg class="ic ${cls}" `);

// ---------- 和 App 里一致的分类、标签逻辑（Models/CallRecord.swift） ----------
const CATEGORY = {
  scam: { label: '疑似诈骗', icon: 'shield-warning', tint: 'red' },
  telemarketing: { label: '推销', icon: 'megaphone', tint: 'orange' },
  robocall: { label: '机器人外呼', icon: 'waveform', tint: 'orange' },
  business: { label: '正常事务', icon: 'buildings', tint: 'accent' },
  personal: { label: '私人来电', icon: 'user', tint: 'green' },
  unknown: { label: '未分类', icon: 'phone', tint: 'gray' },
};
const RECOMMEND = { call_back: '建议回电', ignore: '可以忽略', block: '建议拉黑' };
const URGENCY = { high: '紧急', medium: '一般', low: '不急' };

function categoryOf(call) {
  if ((call.structured.scam_risk ?? 0) >= 70) return 'scam';
  return CATEGORY[call.structured.category] ? call.structured.category : 'unknown';
}
const isNuisance = (c) => ['scam', 'telemarketing', 'robocall'].includes(c);

function displayNumber(n) {
  const d = n.replace(/\D/g, '');
  if (!n.startsWith('+61') || d.length !== 11) return n;
  const s = d.slice(2);
  return s[0] === '4' ? `+61 ${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}` : `+61 ${s[0]} ${s.slice(1, 5)} ${s.slice(5)}`;
}
function titleOf(call) {
  const parts = [call.structured.caller_name, call.structured.organization].filter((p) => p && p.toLowerCase() !== 'unknown');
  return parts.length ? parts.join(' · ') : displayNumber(call.from);
}
const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const callByKey = (key) => DEMO_CALLS.find((c) => c.key === key);

// ---------- iOS 界面零件 ----------
const tag = (text, tint) => `<span class="tag t-${tint}">${esc(text)}</span>`;
const badge = (cat, size) =>
  `<span class="badge t-${CATEGORY[cat].tint}" style="--s:${size}px">${icon(CATEGORY[cat].icon)}</span>`;

function statusBar() {
  return `<div class="status">
    <span class="time">9:41</span>
    <span class="island"></span>
    <span class="sys">
      <svg viewBox="0 0 19 12" width="19" height="12"><rect x="0" y="7.5" width="3.2" height="4.5" rx="1"/><rect x="5.2" y="5" width="3.2" height="7" rx="1"/><rect x="10.4" y="2.5" width="3.2" height="9.5" rx="1"/><rect x="15.6" y="0" width="3.2" height="12" rx="1"/></svg>
      <svg viewBox="0 0 17 12" width="17" height="12"><path d="M8.5 2.6c2.4 0 4.6.9 6.3 2.5l1.3-1.3A10.6 10.6 0 0 0 8.5.7 10.6 10.6 0 0 0 .9 3.8l1.3 1.3a8.8 8.8 0 0 1 6.3-2.5Zm0 3.6c1.4 0 2.7.5 3.7 1.4l1.3-1.3a7 7 0 0 0-10 0l1.3 1.3c1-.9 2.3-1.4 3.7-1.4Zm0 3.5c-.5 0-1 .2-1.3.5l1.3 1.3 1.3-1.3c-.3-.3-.8-.5-1.3-.5Z"/></svg>
      <svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2.5"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" opacity=".45"/></svg>
    </span>
  </div>`;
}

function tabBar(active) {
  const tabs = [
    ['calls', 'phone', '来电'],
    ['forwarding', 'arrow-bend-up-right', '代接设置'],
    ['settings', 'user-circle', '我的'],
  ];
  return `<div class="tabbar"><div class="tabs">${tabs
    .map(([id, ic, label]) => `<div class="tab ${id === active ? 'on' : ''}">${icon(ic)}<span>${label}</span></div>`)
    .join('')}</div></div><div class="home"></div>`;
}

function navInline(title, back) {
  return `<div class="nav-inline"><span class="glass-btn">${icon('caret-left-bold')}</span><span class="nav-title">${title}</span><span class="nav-spacer"></span></div>${
    back ? '' : ''
  }`;
}

const section = (rows, { header, footer } = {}) =>
  `<div class="section">${header ? `<div class="sec-h">${header}</div>` : ''}<div class="card">${rows.join('')}</div>${
    footer ? `<div class="sec-f">${footer}</div>` : ''
  }</div>`;
const row = (html, cls = '') => `<div class="row ${cls}">${html}</div>`;
const labeled = (label, value) => row(`<span class="lbl">${label}</span><span class="val">${esc(value)}</span>`);

// ---------- 页面：来电列表（Features/Calls/CallListView.swift） ----------
function callRow(call, extra = '') {
  const cat = categoryOf(call);
  const s = call.structured;
  const needsAttention = !isNuisance(cat) && s.recommended_action === 'call_back';
  const tags = [];
  if (cat === 'scam') tags.push(tag('疑似诈骗', 'red'));
  if (needsAttention) tags.push(tag(RECOMMEND[s.recommended_action], 'accent'));
  if (needsAttention && s.urgency === 'high') tags.push(tag(URGENCY.high, 'orange'));
  return `<div class="call" data-key="${call.key}" ${extra}>
    ${badge(cat, 40)}
    <div class="call-body">
      <div class="call-top"><span class="call-title">${esc(titleOf(call))}</span><span class="call-time">${call.relative}</span></div>
      <div class="call-sub">${esc(s.summary_zh)}</div>
      ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
    </div>
    <span class="chev">${icon('caret-right-bold')}</span>
  </div>`;
}

// filter：all / nuisance（和 CallStore.visibleCalls 一致）
export function screenCallList({ filter = 'all' } = {}) {
  const calls = filter === 'nuisance' ? DEMO_CALLS.filter((c) => isNuisance(categoryOf(c))) : DEMO_CALLS;
  const seg = [['all', '全部'], ['attention', '需回电'], ['nuisance', '骚扰诈骗']]
    .map(([id, label]) => `<span class="${id === filter ? 'on' : ''}">${label}</span>`).join('');
  return `${statusBar()}
  <div class="nav-large"><h1>来电</h1></div>
  <div class="bar-inset"><div class="seg">${seg}</div></div>
  <div class="plain-list">${calls.map((c) => callRow(c)).join('')}</div>
  ${tabBar('calls')}`;
}

// ---------- 页面：来电详情（Features/Calls/CallDetailView.swift） ----------
function detailTags(call) {
  const cat = categoryOf(call);
  const s = call.structured;
  const items = [tag(CATEGORY[cat].label, CATEGORY[cat].tint)];
  if (s.scam_risk != null) items.push(tag(`诈骗风险 ${s.scam_risk}`, s.scam_risk >= 70 ? 'red' : s.scam_risk >= 40 ? 'orange' : 'gray'));
  if (s.urgency) items.push(tag(URGENCY[s.urgency], s.urgency === 'high' ? 'orange' : 'gray'));
  if (s.recommended_action) items.push(tag(RECOMMEND[s.recommended_action], 'accent'));
  return `<div class="tags">${items.join('')}</div>`;
}

function lookupRow(l) {
  const spam = l.kind === 'spam_report';
  const detail = [l.name ? l.role : null, l.organization].filter(Boolean).join(' · ');
  return row(`<div class="lookup">
      <span class="lookup-ic ${spam ? 't-orange' : 't-accent'}">${icon(spam ? 'chat-circle-dots' : 'identification-card')}</span>
      <div class="lookup-body"><div class="lookup-title">可能是 ${esc(l.name ?? l.role)}</div>${detail ? `<div class="lookup-sub">${esc(detail)}</div>` : ''}</div>
      <span class="conf">${l.confidence}%</span>
    </div>`);
}

function detailSections(call, { transcript = false, actions = true } = {}) {
  const s = call.structured;
  const cat = categoryOf(call);
  const info = [];
  if (call.lookup) info.push(lookupRow(call.lookup));
  info.push(labeled('来电号码', displayNumber(call.from)));
  if (s.purpose) info.push(labeled('来意', s.purpose));
  if (s.callback_number) info.push(labeled('回电号码', s.callback_number));
  if (s.deadline) info.push(labeled('时间要求', s.deadline));
  if (s.scam_reasons?.length) info.push(labeled('判定理由', s.scam_reasons.join('；')));
  info.push(labeled('通话时长', `${call.duration} 秒`));
  const host = call.lookup ? new URL(call.lookup.sources[0]).host.replace('www.', '') : null;

  const out = [
    section([
      row(`<div class="head">${badge(cat, 52)}<div><div class="head-title">${esc(titleOf(call))}</div><div class="head-sub">${call.clock}</div></div></div>`, 'tall'),
      row(detailTags(call), 'tags-row'),
    ]),
    section([row(`<div class="body-text">${esc(s.summary_zh)}</div>`, 'text')], { header: 'AI 摘要' }),
  ];
  if (transcript) {
    out.push(
      section([
        row(`<span class="disc">完整转写</span><span class="chev down">${icon('caret-down-bold')}</span>`),
        row(`<pre class="mono">${esc(call.transcript)}</pre>`, 'text'),
      ]),
    );
  }
  out.push(
    section(info, {
      header: '详情',
      footer: host ? `根据公开网络信息推测，仅供参考。来源：<a>${host}</a>` : null,
    }),
  );
  if (actions) {
    out.push(
      section([
        row(`<span class="act">${icon('phone')}回电 ${displayNumber(call.from)}</span>`),
        row(`<span class="act">${icon('copy')}复制号码</span>`),
        row(`<span class="act red">${icon('hand')}拉黑这个号码</span>`),
      ]),
    );
  }
  return out.join('');
}

export function screenDetail(key, opts) {
  const call = callByKey(key);
  // 来电详情是在「来电」标签页里推进来的，标签栏仍然显示
  return `${statusBar()}${navInline('来电详情')}<div class="grouped">${detailSections(call, opts)}</div>${tabBar('calls')}`;
}

// 完整转写展开：页面向下滚动了一段，只显示摘要和转写
function screenTranscript(key) {
  const call = callByKey(key);
  const s = call.structured;
  return `${statusBar()}${navInline('来电详情')}<div class="grouped">
    ${section([row(`<div class="body-text">${esc(s.summary_zh)}</div>`, 'text')], { header: 'AI 摘要' })}
    ${section([labeled('来意', s.purpose), labeled('回电号码', s.callback_number), labeled('时间要求', s.deadline)], { header: '详情' })}
    ${section([
      row(`<span class="disc">完整转写</span><span class="chev down">${icon('caret-down-bold')}</span>`),
      row(`<pre class="mono">${esc(call.transcript)}</pre>`, 'text'),
    ])}
  </div>${tabBar('calls')}`;
}

// ---------- 页面：我的 › AI 助手（Features/Settings/AssistantSettingsView.swift） ----------
function screenAssistant() {
  const styles = [
    ['mature', '成熟', '自然、从容'],
    ['calm', '稳重', '沉稳、低调'],
    ['young', '年轻', '轻快、有活力'],
  ];
  return `${statusBar()}${navInline('AI 助手')}<div class="grouped">
    ${section([row(`<span class="field">${DEMO_PROFILE.display_name}</span>`)], {
      header: '称呼',
      footer: `AI 接到正常来电时会说「这是 ${DEMO_PROFILE.display_name} 的 AI 助手」。`,
    })}
    <div class="section"><div class="sec-h">声音</div><div class="seg big"><span>男声</span><span class="on">女声</span></div></div>
    ${section(
      styles.map(([id, label, detail]) =>
        row(`<div class="two"><span>${label}</span><span class="cap">${detail}</span></div>${id === DEMO_PROFILE.voice_style ? `<span class="check">${icon('check-bold')}</span>` : ''}`),
      ),
      { header: '音色', footer: '修改后，下一通转过来的电话就会使用新的声音。' },
    )}
  </div>${tabBar('settings')}`;
}

// ---------- 页面：代接设置（Features/Forwarding/ForwardingView.swift） ----------
export function screenForwarding() {
  const toggle = (title, path) =>
    row(`<div class="two"><span>${title}</span><span class="cap">${path}</span></div><span class="switch on"></span>`);
  return `${statusBar()}<div class="nav-large"><h1>代接设置</h1></div><div class="grouped tight">
    ${section(
      [
        row(`<div class="head">${icon('check-circle', 'status-ic')}<div><div class="head-title sm">代接已开启</div><div class="head-sub">10月20日 设置。你没接的电话会转给 AI 接听。</div></div></div>`, 'tall'),
        labeled('代接号码', '+61 2 5849 6666'),
      ],
      { footer: '状态以你在本 App 里的确认为准。想确认是否生效，可以用另一部手机打你的手机，不接，看来电记录里是否出现。' },
    )}
    ${section(
      [
        row(`<span class="lbl">无人接听等待</span><span class="val">20 秒 <span class="updown">⌃<br>⌄</span></span>`),
        row(`<span class="act strong">${icon('phone-outgoing')}开启代接</span>`),
        row(`<span class="act red">${icon('phone-x')}关闭代接</span>`),
      ],
      { header: '开启或关闭', footer: '出国前建议先关闭代接，避免转移产生漫游费用。' },
    )}
    ${section(
      [
        toggle('已关闭「实时语音留言」', '设置 › App › 电话 › 实时语音留言'),
        toggle('「筛选陌生来电」设为「不筛选」', '设置 › App › 电话 › 筛选陌生来电'),
        row(`<span class="act">${icon('gear')}打开「电话」设置</span>`),
      ],
      { header: 'iPhone 设置检查' },
    )}
  </div>${tabBar('forwarding')}`;
}

// ---------- 页面：订阅（Features/Subscription/SubscriptionView.swift，未订阅状态）。内购审核截图用 ----------
export function screenSubscription() {
  const logo = `data:image/png;base64,${readFileSync(join(HERE, '..', 'CallAssistant', 'Resources', 'Assets.xcassets', 'LaunchLogo.imageset', 'LaunchLogo@3x.png')).toString('base64')}`;
  const feature = (ic, text) => `<div class="feat">${icon(ic)}<span>${text}</span></div>`;
  const plan = (name, price, on) => `<div class="plan ${on ? 'on' : ''}"><span>${name}</span><span>${price}</span></div>`;
  return `${statusBar()}<div class="sheet">
    <div class="sheet-close">${icon('x-circle')}</div>
    <div class="pay-head"><span class="pay-logo"><img src="${logo}"></span><h2>来电助手 Pro</h2></div>
    <div class="feats">
      ${feature('phone-incoming-bold', '没接的电话由 AI 接听，不限分钟')}
      ${feature('translate-bold', '中英文自动切换')}
      ${feature('shield-warning-bold', '识别诈骗和推销电话')}
      ${feature('chat-text-bold', '每通电话都有中文摘要')}
    </div>
    <div class="plans">${plan('月付', 'A$14.99 / 月', true)}${plan('年付', 'A$149.99 / 年', false)}</div>
    <div class="pay-bar">
      <div class="pay-btn">订阅</div>
      <div class="pay-note">订阅按所选周期自动续费，可随时在系统设置中取消。</div>
      <div class="pay-links"><span>恢复购买</span><span>使用条款</span><span>隐私政策</span></div>
    </div>
  </div>`;
}

// ---------- 每张截图的标题 ----------
export const SHOTS = [
  {
    id: 'calls',
    screen: screenCallList,
    'zh-Hans': ['没接的电话，AI 替你接', '问清是谁、什么事，几秒后摘要就到手机'],
    'en-AU': ['Missed calls, answered by AI', 'Know who called and why, seconds after they hang up'],
  },
  {
    id: 'summary',
    screen: () => screenDetail('dental'),
    'zh-Hans': ['每通电话，都有中文摘要', '来意、回电号码、截止时间，一眼看清'],
    'en-AU': ['A clear summary of every call', 'Purpose, callback number and deadline at a glance'],
  },
  {
    id: 'scam',
    screen: () => screenDetail('scam'),
    'zh-Hans': ['诈骗电话，自动识别', '冒充使领馆、警察、银行，标红提醒并挂断'],
    'en-AU': ['Scam calls, flagged for you', 'Fake embassy, police or bank calls are marked and ended'],
  },
  {
    id: 'lookup',
    screen: () => screenDetail('agent'),
    'zh-Hans': ['陌生号码，帮你查是谁', '根据公开网络信息推测，并注明来源'],
    'en-AU': ['Unknown number? See who it might be', 'A best guess from public web information, with the source'],
  },
  {
    id: 'bilingual',
    screen: () => screenTranscript('dental'),
    'zh-Hans': ['英文、普通话，自动切换', '对方说英文，AI 用英文应答；摘要统一用中文'],
    'en-AU': ['Answers in English or Mandarin', 'The AI matches the caller; the app and summaries are in Chinese'],
  },
  {
    id: 'voice',
    screen: screenAssistant,
    'zh-Hans': ['你的称呼，你选的声音', '「这是 Charlie 的 AI 助手」，男声女声随时换'],
    'en-AU': ['Your name, your choice of voice', '"This is Charlie\'s AI assistant", in the voice you pick'],
  },
  {
    id: 'forwarding',
    screen: screenForwarding,
    'zh-Hans': ['号码不变，两分钟设置', '不换号、不换卡，三大运营商都支持'],
    'en-AU': ['Keep your number. Set up in minutes', 'Works with Telstra, Optus and Vodafone'],
  },
];

// ---------- 样式 ----------
export const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --accent: #246E5E; --red: #FF3B30; --orange: #FF9500; --green: #34C759; --gray: #8E8E93;
  --label: #000; --label2: rgba(60,60,67,.6); --label3: rgba(60,60,67,.3); --sep: rgba(60,60,67,.18);
  --grouped: #F2F2F7;
  --font: "Inter", "Noto Sans SC", "PingFang SC", -apple-system, sans-serif;
}
html, body { width: var(--w); height: var(--h); overflow: hidden; }
body { font-family: var(--font); -webkit-font-smoothing: antialiased; color: #fff;
  background: radial-gradient(120% 60% at 85% 0%, #2f8a75 0%, rgba(47,138,117,0) 60%), linear-gradient(180deg, #246E5E 0%, #143f36 100%); }
.ic { width: 1em; height: 1em; display: inline-block; flex: none; }

.canvas { position: relative; width: var(--w); height: var(--h); display: flex; flex-direction: column; align-items: center; }
.deco { position: absolute; right: -40px; top: -30px; width: 230px; height: 230px; opacity: .07; }
.caption { height: var(--cap); padding: calc(var(--h) * 0.062) 24px 0; text-align: center; flex: none; }
.caption h2, .caption p { text-wrap: balance; }
.caption h2 { font-size: 33px; line-height: 1.22; font-weight: 700; letter-spacing: -0.2px; }
.caption p { margin-top: 10px; font-size: 16.5px; line-height: 1.45; color: rgba(255,255,255,.82); font-weight: 400; }
[lang=en] .caption h2 { font-size: 31px; letter-spacing: -0.5px; }
.phone-wrap { flex: 1; width: 100%; position: relative; }
.phone { position: absolute; left: 50%; top: 26px; width: 426px; height: 898px; transform-origin: top center;
  transform: translateX(-50%) scale(var(--ps)); border-radius: 70px; background: #0b0d0c; padding: 12px;
  box-shadow: 0 0 0 1.5px #3b4744, 0 40px 80px -20px rgba(0,0,0,.55), inset 0 0 0 2px #1d2321; }
.screen { position: relative; width: 402px; height: 874px; border-radius: 58px; overflow: hidden; background: #fff; color: var(--label); }
.screen.grouped-bg { background: var(--grouped); }

/* 状态栏 */
.status { height: 54px; display: flex; align-items: center; justify-content: space-between; padding: 0 32px 0 50px; position: relative; font-weight: 600; }
.status .time { font-size: 17px; letter-spacing: -0.2px; }
.status .island { position: absolute; left: 50%; top: 11px; transform: translateX(-50%); width: 124px; height: 36px; border-radius: 20px; background: #000; }
.status .sys { display: flex; gap: 6px; align-items: center; }
.status svg { fill: currentColor; }

/* 导航 */
.nav-large { padding: 46px 16px 6px; }
.nav-large h1 { font-size: 34px; font-weight: 700; letter-spacing: 0.2px; }
.nav-inline { height: 56px; display: flex; align-items: center; padding: 0 16px; }
.glass-btn { width: 44px; height: 44px; border-radius: 22px; display: grid; place-items: center; font-size: 19px; color: var(--label);
  background: rgba(255,255,255,.75); box-shadow: 0 1px 6px rgba(0,0,0,.08), inset 0 0 0 .5px rgba(0,0,0,.06); }
.nav-title { flex: 1; text-align: center; font-size: 17px; font-weight: 600; }
.nav-spacer { width: 44px; }

/* 分段控件 */
.bar-inset { padding: 0 16px 8px; }
.seg { display: flex; background: rgba(118,118,128,.12); border-radius: 100px; padding: 3px; height: 36px; }
.seg span { flex: 1; display: grid; place-items: center; font-size: 14px; font-weight: 500; border-radius: 100px; }
.seg span.on { background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.1); font-weight: 600; }
.seg.big { height: 40px; margin: 0 16px; }

/* 来电列表 */
.plain-list { border-top: .5px solid var(--sep); }
.call { display: flex; gap: 12px; padding: 12px 16px 12px 16px; position: relative; align-items: flex-start; }
.call::after { content: ""; position: absolute; left: 68px; right: 0; bottom: 0; border-bottom: .5px solid var(--sep); }
.call-body { flex: 1; min-width: 0; }
.call-top { display: flex; align-items: baseline; gap: 8px; }
.call-title { flex: 1; font-size: 17px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.call-time { font-size: 12px; color: var(--label2); }
.call-sub { margin-top: 4px; font-size: 15px; line-height: 1.35; color: var(--label2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; }
.call .tags { margin-top: 7px; }
.chev { color: var(--label3); font-size: 13px; align-self: center; }
.badge { width: var(--s); height: var(--s); border-radius: 50%; display: grid; place-items: center; font-size: calc(var(--s) * 0.46); flex: none; }
.tag { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 100px; }
.t-accent { color: var(--accent); background: rgba(36,110,94,.12); }
.t-red { color: var(--red); background: rgba(255,59,48,.12); }
.t-orange { color: #E08600; background: rgba(255,149,0,.13); }
.t-green { color: var(--green); background: rgba(52,199,89,.13); }
.t-gray { color: var(--label2); background: rgba(118,118,128,.12); }
.badge.t-orange { color: var(--orange); }

/* 分组列表 */
.grouped { padding: 4px 16px 0; }
.grouped.tight { padding-top: 0; }
.section { margin-bottom: 22px; }
.sec-h { font-size: 14px; color: var(--label2); padding: 0 16px 7px; }
.sec-f { font-size: 13px; line-height: 1.4; color: var(--label2); padding: 7px 16px 0; }
.sec-f a { color: var(--accent); }
.card { background: #fff; border-radius: 22px; overflow: hidden; }
.row { min-height: 52px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; position: relative; font-size: 17px; }
.row + .row::before { content: ""; position: absolute; top: 0; left: 16px; right: 0; border-top: .5px solid var(--sep); }
.row.tall { padding-top: 12px; padding-bottom: 10px; }
.row.text { padding-top: 13px; padding-bottom: 13px; }
.row.tags-row { min-height: 46px; padding-bottom: 6px; }
.row.tags-row::before { display: none; }
.lbl { flex: none; }
.val { color: var(--label2); text-align: right; line-height: 1.35; padding: 13px 0; }
.head { display: flex; gap: 14px; align-items: center; }
.head-title { font-size: 20px; font-weight: 600; }
.head-title.sm { font-size: 17px; }
.head-sub { font-size: 15px; color: var(--label2); margin-top: 3px; line-height: 1.35; }
.body-text { font-size: 17px; line-height: 1.45; }
.mono { font-family: "SF Mono", "JetBrains Mono", "DejaVu Sans Mono", "Noto Sans SC", monospace; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; color: var(--label); }
.disc { font-size: 17px; }
.chev.down { color: var(--accent); font-size: 14px; }
.act { display: flex; align-items: center; gap: 12px; color: var(--accent); font-size: 17px; }
.act .ic { font-size: 19px; }
.act.red { color: var(--red); }
.act.strong { font-weight: 600; }
.lookup { display: flex; align-items: center; gap: 12px; padding: 10px 0; width: 100%; }
.lookup-ic { font-size: 23px; width: 28px; background: none !important; display: grid; place-items: center; }
.lookup-body { flex: 1; }
.lookup-title { font-size: 15px; font-weight: 600; }
.lookup-sub { font-size: 12px; color: var(--label2); margin-top: 2px; }
.conf { font-size: 12px; font-weight: 600; color: var(--accent); background: rgba(36,110,94,.12); padding: 3px 8px; border-radius: 100px; }
.field { font-size: 17px; }
.two { display: flex; flex-direction: column; gap: 2px; padding: 10px 0; }
.cap { font-size: 12px; color: var(--label2); }
.check { color: var(--accent); font-size: 18px; }
.status-ic { color: var(--accent); font-size: 36px; }
.switch { width: 52px; height: 32px; border-radius: 16px; background: var(--green); position: relative; flex: none; }
.switch::after { content: ""; position: absolute; right: 2px; top: 2px; width: 28px; height: 28px; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.2); }
.updown { display: inline-block; font-size: 10px; line-height: 7px; vertical-align: middle; margin-left: 4px; }

/* 订阅页 */
.sheet { position: absolute; left: 0; right: 0; top: 54px; bottom: 0; padding: 0 24px; }
.sheet-close { position: absolute; right: 18px; top: 6px; font-size: 30px; color: rgba(118,118,128,.45); }
.pay-head { text-align: center; padding-top: 44px; }
.pay-logo { display: inline-grid; place-items: center; width: 72px; height: 72px; border-radius: 18px; background: var(--accent); }
.pay-logo img { width: 44px; height: 44px; }
.pay-head h2 { font-size: 28px; font-weight: 700; margin-top: 12px; }
.feats { margin-top: 28px; display: flex; flex-direction: column; gap: 16px; }
.feat { display: flex; align-items: center; gap: 14px; font-size: 17px; }
.feat .ic { width: 28px; font-size: 21px; color: var(--accent); }
.plans { margin-top: 28px; display: flex; flex-direction: column; gap: 12px; }
.plan { display: flex; justify-content: space-between; padding: 18px; border-radius: 16px; background: #F2F2F7; font-size: 17px; font-weight: 600; border: 2px solid transparent; }
.plan.on { border-color: var(--accent); }
.pay-bar { position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 24px 40px; text-align: center; background: rgba(249,249,249,.94); border-top: .5px solid var(--sep); }
.pay-btn { height: 54px; border-radius: 16px; background: var(--accent); color: #fff; font-size: 17px; font-weight: 600; display: grid; place-items: center; }
.pay-note { font-size: 11px; color: var(--label2); margin-top: 10px; }
.pay-links { display: flex; justify-content: center; gap: 16px; font-size: 12px; color: var(--accent); margin-top: 10px; }

/* 标签栏（iOS 26 悬浮样式） */
.tabbar { position: absolute; left: 0; right: 0; bottom: 30px; display: flex; justify-content: center; }
.tabs { display: flex; gap: 4px; padding: 4px; border-radius: 100px; background: rgba(250,250,250,.82);
  box-shadow: 0 6px 24px rgba(0,0,0,.12), inset 0 0 0 .5px rgba(0,0,0,.08); backdrop-filter: blur(20px); }
.tab { width: 104px; height: 56px; border-radius: 100px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: 10px; font-weight: 600; color: #1c1c1e; }
.tab .ic { font-size: 23px; }
.tab.on { color: var(--accent); background: rgba(118,118,128,.14); }
.home { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); width: 140px; height: 5px; border-radius: 3px; background: #000; }
`;

// 一张截图的完整 HTML。width/height 是 CSS 像素（实际像素 ÷ 3）。
export function shotHtml(shot, locale, { width, height }) {
  const [title, sub] = shot[locale];
  const w = width / SCALE;
  const h = height / SCALE;
  // 标题区高度按语言固定（中文标题、副标题各一行，英文各两行），同一组截图里手机的位置保持一致
  const [titleLines, subLines] = locale === 'en-AU' ? [2, 2] : [1, 1];
  const captionH = h * 0.062 + 33 * 1.22 * titleLines + 10 + 16.5 * 1.45 * subLines;
  const ps = Math.min((w - 52) / 426, (h - captionH - 26 - 30) / 898);
  const grouped = shot.id !== 'calls';
  return `<!doctype html><html lang="${locale === 'en-AU' ? 'en' : 'zh-Hans'}"><head><meta charset="utf-8">
<style>${CSS}</style></head>
<body style="--w:${w}px;--h:${h}px;--ps:${ps.toFixed(4)};--cap:${captionH.toFixed(1)}px">
<div class="canvas">
  <svg class="deco" viewBox="0 0 256 256">${ICONS.waveform.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</svg>
  <div class="caption"><h2>${esc(title)}</h2><p>${esc(sub)}</p></div>
  <div class="phone-wrap"><div class="phone"><div class="screen ${grouped ? 'grouped-bg' : ''}">${shot.screen()}</div></div></div>
</div></body></html>`;
}

// App Store 搜索结果和产品页顶部的预览（只给你自己看效果，不上传）
function searchPreviewHtml(locale, shotFiles) {
  const meta = (f) => readFileSync(join(HERE, '..', 'fastlane', 'metadata', locale, f), 'utf8').trim();
  const iconData = `data:image/png;base64,${readFileSync(ICON_PNG).toString('base64')}`;
  const thumbs = shotFiles.slice(0, 3).map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString('base64')}">`).join('');
  const zh = locale === 'zh-Hans';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 402px; font-family: "Inter", "Noto Sans SC", sans-serif; background: #fff; padding: 20px 16px 28px; color: #000; }
  .label { font-size: 12px; font-weight: 600; color: #8e8e93; text-transform: uppercase; letter-spacing: .4px; margin: 4px 0 12px; }
  .top { display: flex; gap: 12px; align-items: center; }
  .top img { width: 64px; height: 64px; border-radius: 15px; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.1); }
  .name { font-size: 16px; font-weight: 600; }
  .sub { font-size: 13px; color: #8e8e93; margin-top: 2px; }
  .get { margin-left: auto; background: #eef0f3; color: #007aff; font-weight: 700; font-size: 15px; padding: 6px 20px; border-radius: 100px; }
  .iap { font-size: 9px; color: #8e8e93; text-align: center; margin-top: 3px; }
  .thumbs { display: flex; gap: 8px; margin-top: 14px; }
  .thumbs img { width: calc((100% - 16px) / 3); border-radius: 12px; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.1); }
  hr { border: 0; border-top: .5px solid #d1d1d6; margin: 26px 0 18px; }
  .hero { display: flex; gap: 16px; }
  .hero img { width: 118px; height: 118px; border-radius: 26px; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.1); }
  .hero .name { font-size: 21px; font-weight: 700; line-height: 1.2; }
  .hero .sub { font-size: 15px; margin-top: 4px; }
  .hero .get { margin: 18px 0 0; display: inline-block; background: #007aff; color: #fff; }
  .promo { font-size: 14px; line-height: 1.45; color: #3c3c43; margin-top: 18px; }
  </style></head><body>
  <div class="label">${zh ? '搜索结果' : 'Search result'}</div>
  <div class="top"><img src="${iconData}"><div><div class="name">${esc(meta('name.txt'))}</div><div class="sub">${esc(meta('subtitle.txt'))}</div></div>
    <div style="margin-left:auto"><div class="get">${zh ? '获取' : 'Get'}</div><div class="iap">${zh ? 'App 内购买' : 'In-App Purchases'}</div></div></div>
  <div class="thumbs">${thumbs}</div>
  <hr>
  <div class="label">${zh ? '产品页顶部' : 'Product page header'}</div>
  <div class="hero"><img src="${iconData}"><div><div class="name">${esc(meta('name.txt'))}</div><div class="sub">${esc(meta('subtitle.txt'))}</div><div class="get">${zh ? '获取' : 'Get'}</div></div></div>
  <div class="promo">${esc(meta('promotional_text.txt'))}</div>
  </body></html>`;
}

async function main() {
  const htmlOnly = process.argv.includes('--html');
  mkdirSync(BUILD, { recursive: true });
  // require 能找到全局安装的 playwright（ESM 的 import 不会去全局目录找）
  const { chromium } = htmlOnly ? {} : createRequire(import.meta.url)('playwright');
  const browser = htmlOnly ? null : await chromium.launch();

  for (const locale of ['zh-Hans', 'en-AU']) {
    mkdirSync(join(OUT, locale), { recursive: true });
    const firstShots = [];
    for (const size of SIZES) {
      for (const [i, shot] of SHOTS.entries()) {
        const html = shotHtml(shot, locale, size);
        const name = `${i + 1}_${shot.id}_${size.id}`;
        if (htmlOnly) {
          writeFileSync(join(BUILD, `${locale}_${name}.html`), html);
          continue;
        }
        const page = await browser.newPage({ viewport: { width: size.width / SCALE, height: size.height / SCALE }, deviceScaleFactor: SCALE });
        await page.setContent(html, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const file = join(OUT, locale, `${name}.png`);
        await page.screenshot({ path: file, type: 'png' });
        await page.close();
        if (size.id === '6.9' && i < 3) firstShots.push(file);
        console.log(file.replace(join(HERE, '..') + '/', 'ios/'));
      }
    }
    if (!htmlOnly) {
      const page = await browser.newPage({ viewport: { width: 402, height: 600 }, deviceScaleFactor: 3 });
      await page.setContent(searchPreviewHtml(locale, firstShots), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const file = join(HERE, 'preview', `search-${locale}.png`);
      mkdirSync(dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      console.log(file.replace(join(HERE, '..') + '/', 'ios/'));
    }
  }
  if (!htmlOnly) {
    // 内购审核截图（App Store Connect › 订阅 › 审核信息），只要订阅页本身，不加标题
    const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: SCALE });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS} body { --w: 402px; --h: 874px; }</style></head>
      <body><div class="screen" style="border-radius:0">${screenSubscription()}</div></body></html>`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const file = join(HERE, 'preview', 'iap-review-subscription.png');
    await page.screenshot({ path: file });
    await page.close();
    console.log(file.replace(join(HERE, '..') + '/', 'ios/'));
  }
  await browser?.close();
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
