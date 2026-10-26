// 生成 App 预览视频（App Preview）：用截图里同一套界面，按时间轴逐帧渲染一遍使用流程，ffmpeg 编码成苹果要求的格式。
//   node ios/appstore/render-preview.mjs
// 输出 ios/appstore/preview/app-preview-zh-Hans.mp4：886×1920、30fps、H.264、带静音立体声音轨、24 秒。
// 适用 6.9 / 6.7 / 6.5 英寸 iPhone。fastlane deliver 不上传预览视频，需要在 App Store Connect 网页里拖进去。
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS, screenCallList, screenDetail, screenForwarding } from './render-screenshots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'preview', 'app-preview-zh-Hans.mp4');
const W = 886;
const H = 1920;
const FPS = 30;
const DURATION = 24;

// 字幕：[开始, 结束, 文字]
const CAPTIONS = [
  [0.3, 3.2, '没接的电话，AI 替你接'],
  [3.4, 7.5, '每通电话，都有中文摘要'],
  [8.2, 13.5, '诈骗电话，自动识别'],
  [14.4, 18.7, '陌生号码，帮你查是谁'],
  [19.4, 24, '号码不变，两分钟设置'],
];

const PAGE_CSS = `${CSS}
html, body { width: ${W / 2}px; height: ${H / 2}px; background: #000; }
.stage { position: absolute; left: 0; top: 0; width: 402px; height: 874px; transform-origin: 0 0; transform: scale(${W / 2 / 402}); overflow: hidden; background: #fff; }
.layer { position: absolute; inset: 0; background: #fff; color: var(--label); overflow: hidden; will-change: transform; }
.layer.grouped-bg { background: var(--grouped); }
.dim { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
.tap { position: absolute; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; background: rgba(0,0,0,.18); opacity: 0; }
.call.pressed { background: #E5E5EA; }
/* 内容向上滚动时从导航栏下面经过 */
.layer .status, .layer .nav-inline { position: relative; z-index: 2; background: #F2F2F7; }
.layer:not(.grouped-bg) .status { background: #fff; }
.cap-pill { position: absolute; left: 50%; bottom: 118px; transform: translateX(-50%); padding: 12px 22px; border-radius: 100px; white-space: nowrap;
  background: rgba(20,63,54,.92); color: #fff; font-size: 19px; font-weight: 700; letter-spacing: .3px; box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; }
`;

const LAYERS = [
  ['list', screenCallList(), false],
  ['listNuisance', screenCallList({ filter: 'nuisance' }), false],
  ['dental', screenDetail('dental'), true],
  ['scam', screenDetail('scam'), true],
  ['agent', screenDetail('agent'), true],
  ['forwarding', screenForwarding(), true],
];

const html = `<!doctype html><html lang="zh-Hans"><head><meta charset="utf-8"><style>${PAGE_CSS}</style></head><body>
<div class="stage">
  ${LAYERS.map(([id, body, grouped]) => `<div class="layer ${grouped ? 'grouped-bg' : ''}" id="${id}">${body}</div>`).join('')}
  <div class="dim" id="dim"></div>
  <div class="tap" id="tap"></div>
  <div class="cap-pill" id="cap"></div>
</div>
<script>
const CAPTIONS = ${JSON.stringify(CAPTIONS)};
const $ = (s, root = document) => root.querySelector(s);
const clamp = (x) => Math.max(0, Math.min(1, x));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// 新来电：列表最上面一行从 0 高度展开，时间显示「刚刚」
const incoming = $('#list .call[data-key="dental"]');
incoming.querySelector('.call-time').textContent = '刚刚';
const incomingH = incoming.offsetHeight;
// 陌生号码分析：详情页打开后稍等片刻才出现（和 App 里异步加载一致）
const lookupRow = $('#agent .lookup').parentElement;
const lookupH = lookupRow.offsetHeight;

function pushProgress(t, start, end) {
  // 0 = 不在屏幕上（右侧），1 = 完全显示
  return ease(seg(t, start, start + 0.38)) * (1 - ease(seg(t, end, end + 0.36)));
}

function tapAt(t, t0, el, dx = 0) {
  const tap = $('#tap');
  const p = seg(t, t0, t0 + 0.35);
  if (p <= 0 || p >= 1) return false;
  const stage = $('.stage').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const k = stage.width / 402;
  tap.style.left = ((r.left + r.width / 2 + dx) - stage.left) / k + 'px';
  tap.style.top = ((r.top + r.height / 2) - stage.top) / k + 'px';
  tap.style.opacity = String(Math.sin(p * Math.PI) * 0.9);
  tap.style.transform = 'scale(' + (0.7 + 0.5 * p) + ')';
  return true;
}

window.renderAt = (t) => {
  // 新来电展开
  const e = ease(seg(t, 1.0, 1.6));
  incoming.style.height = incomingH * e + 'px';
  incoming.style.opacity = String(seg(t, 1.2, 1.7));
  incoming.style.overflow = 'hidden';
  incoming.style.paddingTop = incoming.style.paddingBottom = 12 * e + 'px';

  // 筛选「骚扰诈骗」8.4–14.2
  const nuis = seg(t, 8.4, 8.55) * (1 - seg(t, 14.2, 14.35));
  $('#listNuisance').style.opacity = String(nuis);
  $('#listNuisance').style.display = nuis > 0 ? 'block' : 'none';

  // 详情页推入 / 返回
  const pushes = { dental: [2.95, 7.55], scam: [9.95, 13.55], agent: [14.95, 18.6] };
  let pushed = 0;
  for (const [id, [a, b]] of Object.entries(pushes)) {
    const p = pushProgress(t, a, b);
    const el = $('#' + id);
    el.style.display = p > 0 ? 'block' : 'none';
    el.style.transform = 'translateX(' + (1 - p) * 100 + '%)';
    el.style.boxShadow = p > 0 && p < 1 ? '-8px 0 24px rgba(0,0,0,.12)' : 'none';
    pushed = Math.max(pushed, p);
  }
  for (const id of ['list', 'listNuisance']) $('#' + id).style.transform = 'translateX(' + -30 * pushed + '%)';
  $('#dim').style.opacity = String(0.08 * pushed * (pushed < 1 ? 1 : 0));

  // 详情页向下滚动一点，露出回电、拉黑
  $('#dental .grouped').style.transform = 'translateY(' + -150 * ease(seg(t, 5.0, 6.3)) + 'px)';
  // 陌生号码分析出现
  const l = ease(seg(t, 15.9, 16.3));
  lookupRow.style.height = lookupH * l + 'px';
  lookupRow.style.minHeight = '0';
  lookupRow.style.overflow = 'hidden';
  lookupRow.style.opacity = String(seg(t, 16.0, 16.5));

  // 点按反馈
  const rows = (id) => [...document.querySelectorAll('#' + id + ' .call')];
  document.querySelectorAll('.call.pressed').forEach((r) => r.classList.remove('pressed'));
  const press = (el, t0) => { if (t >= t0 && t < t0 + 0.4) el.classList.add('pressed'); };
  $('#tap').style.opacity = '0';
  const dentalRow = rows('list')[0], agentRow = rows('list')[2], scamRow = rows('listNuisance')[0];
  press(dentalRow, 2.6); press(scamRow, 9.6); press(agentRow, 14.6);
  tapAt(t, 2.6, dentalRow, -40) || tapAt(t, 9.6, scamRow, -40) || tapAt(t, 14.6, agentRow, -40) ||
    tapAt(t, 8.15, $('#list .seg span:nth-child(3)')) || tapAt(t, 13.95, $('#listNuisance .seg span:nth-child(1)')) ||
    tapAt(t, 19.05, $('#list .tab:nth-child(2)'));

  // 切到「代接设置」标签
  const f = seg(t, 19.3, 19.55);
  $('#forwarding').style.display = f > 0 ? 'block' : 'none';
  $('#forwarding').style.opacity = String(f);

  // 字幕
  const cap = $('#cap');
  const c = CAPTIONS.find(([a, b]) => t >= a && t < b);
  if (c) {
    cap.textContent = c[2];
    cap.style.opacity = String(Math.min(seg(t, c[0], c[0] + 0.3), 1 - seg(t, c[1] - 0.3, c[1])));
  } else cap.style.opacity = '0';
};
</script></body></html>`;

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const { chromium } = createRequire(import.meta.url)('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W / 2, height: H / 2 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest', '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-preset', 'slow', '-crf', '16',
    '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  const frames = DURATION * FPS;
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.renderAt(t), i / FPS);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if (i % 90 === 0) process.stdout.write(`\r${Math.round((i / frames) * 100)}%`);
  }
  ffmpeg.stdin.end();
  await new Promise((resolve, reject) => ffmpeg.on('close', (code) => (code ? reject(new Error('ffmpeg ' + code)) : resolve())));
  await browser.close();
  console.log(`\r${OUT}`);
}

await main();
