// 呼叫转移自测的判定逻辑（纯函数，便于单元测试）。
//
// 一次测试会在 forward_tests 表里留下两类记录（用 raw_params.kind 区分）：
//   outbound：Twilio 号码拨打被测手机这一通电话（raw_params.to），以及 Twilio 回报的最终状态
//   inbound ：被运营商转回 Twilio 号码的那一通电话，带有来电显示和转移来源
import { samePhone } from './phone.js';

export const TEST_WINDOW_SECONDS = 150;

// 测试进行中时，哪些来电算作「被转回来的测试电话」。targetNumber 是这次测试拨打的手机号。
// 不同运营商转移时来电显示可能是我们的 Twilio 号码（原主叫），也可能被改成被测号码。
export function isForwardedTestCall({ from, forwardedFrom, ourNumber, targetNumber, testActive }) {
  if (samePhone(from, ourNumber)) return true;
  if (!testActive || !targetNumber) return false;
  return samePhone(from, targetNumber) || samePhone(forwardedFrom, targetNumber);
}

// 把 Twilio 回报的外呼状态翻译成可操作的诊断信息。
export function explainOutbound({ status, durationSeconds, gotInbound }) {
  if (gotInbound) return { ok: true, text: '运营商已把电话转回 Twilio 号码。' };
  switch (status) {
    case 'no-answer':
      return {
        ok: false,
        text: '手机一直响到超时都没有转移。无人接听转移可能没设置成功，或运营商的等待时间超过 60 秒。请重新拨 **61*<你的 Twilio 号码>**20# 并确认看到"设置成功"的提示。',
      };
    case 'busy':
      return {
        ok: false,
        text: '你按了拒接，但电话没有被转移。占线/拒接转移（**67*）可能没设置成功。',
      };
    case 'completed':
      return {
        ok: false,
        text: `电话被接起了（约 ${durationSeconds || 0} 秒），但没有转到 Twilio 号码。很可能被运营商语音信箱或 iPhone 的「实时语音留言」接走了：请在 iPhone 设置 › App › 电话 里关闭「实时语音留言」，并重新设置转移代码。`,
      };
    case 'failed':
    case 'canceled':
      return { ok: false, text: `Twilio 没能拨出测试电话（状态：${status}）。请检查被测号码的格式和 Twilio 的澳洲拨号权限。` };
    case 'dialing':
    case undefined:
    case null:
      return { ok: null, text: '正在等待结果…手机响起后按拒接或不接，大约 1 分钟后会自动出结果。' };
    default:
      return { ok: false, text: `测试电话状态：${status}，没有收到转回的电话。` };
  }
}

export function explainInbound({ from, forwardedFrom, matchedOwner, ourNumber, targetNumber }) {
  const shownAs = samePhone(from, ourNumber) ? '测试号码本身' : samePhone(from, targetNumber) ? '被测手机号' : from || '未知';
  if (!forwardedFrom) {
    return {
      ok: true,
      text: `转移成功，但运营商没有带「转移来源」（来电显示为${shownAs}）。转移本身能用；以后多用户时这类运营商需要独立号码。`,
    };
  }
  if (matchedOwner === true || (matchedOwner === undefined && samePhone(forwardedFrom, targetNumber))) {
    return { ok: true, text: `转移成功，运营商带了转移来源 ${forwardedFrom}，与被测手机号一致（可以共用号码）。` };
  }
  return { ok: true, text: `转移成功，运营商带了转移来源 ${forwardedFrom}，但与被测手机号不一致，请检查号码格式。` };
}

// 把 forward_tests 里的外呼记录和转回来的来电配对，每次测试给出一条诊断。
export function summarizeTests(rows, { ourNumber, now = Date.now() }) {
  const kindOf = (r) => r.raw_params?.kind || (r.raw_params?.From ? 'inbound' : 'outbound');
  const inbound = rows.filter((r) => kindOf(r) === 'inbound');
  const outbound = rows.filter((r) => kindOf(r) === 'outbound');
  const used = new Set();
  const results = outbound.map((o) => {
    const start = new Date(o.created_at).getTime();
    const hit = inbound.find((i) => {
      const t = new Date(i.created_at).getTime();
      return !used.has(i) && t >= start && t <= start + TEST_WINDOW_SECONDS * 1000;
    });
    if (hit) {
      used.add(hit);
      return { created_at: o.created_at, ...explainInbound({ from: hit.raw_params?.From, forwardedFrom: hit.forwarded_from, matchedOwner: hit.matched_owner ?? undefined, ourNumber, targetNumber: o.raw_params?.to }) };
    }
    const status = o.raw_params?.status;
    if ((status === 'dialing' || !status) && now - start > TEST_WINDOW_SECONDS * 1000) {
      return { created_at: o.created_at, ok: false, text: '没有收到转回的电话，也没有收到 Twilio 的状态回报。请确认 Vercel 已部署最新版本，然后重新测试。' };
    }
    return { created_at: o.created_at, ...explainOutbound({ status, durationSeconds: o.raw_params?.duration, gotInbound: false }) };
  });
  // 旧版本留下的、没有对应外呼记录的转回来电
  for (const i of inbound) {
    if (!used.has(i)) {
      results.push({ created_at: i.created_at, ...explainInbound({ from: i.raw_params?.From, forwardedFrom: i.forwarded_from, matchedOwner: i.matched_owner ?? undefined, ourNumber }) });
    }
  }
  return results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
}
