// 把 Vapi 的通话报告和我们记录的 Twilio 来电对上号。
// 优先级：
//   1. 报告里能找到我们通过 SIP 头传过去的 Twilio CallSid（最可靠）
//   2. 来电号码相同，且在报告开始前 30 分钟内、尚未匹配过的来电（作为备选，并标记出来）
// 两者都不满足时不做归属，保存为「未匹配」。

const CALL_SID_PATTERN = /CA[0-9a-f]{32}/g;

export function findCallSids(payload) {
  const text = JSON.stringify(payload ?? {});
  return [...new Set(text.match(CALL_SID_PATTERN) || [])];
}

// 在 Vapi 的回调里找我们通过 SIP 头传过去的值（例如 x-user_id）。不同版本放的位置不同，头名大小写也可能变，所以整棵树找。
export function findHeaderValue(payload, name) {
  const target = name.toLowerCase();
  const stack = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    for (const [key, value] of Object.entries(node)) {
      if (key.toLowerCase() === target && typeof value === 'string' && value) return value;
      if (value && typeof value === 'object') stack.push(value);
    }
  }
  return null;
}

export function pickByCallerAndTime(candidates, { callerMatches, reportStartedAt, windowMinutes = 30 }) {
  const start = reportStartedAt ? new Date(reportStartedAt).getTime() : Date.now();
  const earliest = start - windowMinutes * 60 * 1000;
  return (
    candidates
      .filter((c) => !c.vapi_call_id)
      .filter((c) => callerMatches(c.from_number))
      .filter((c) => {
        const t = new Date(c.created_at).getTime();
        return t >= earliest && t <= start + 60 * 1000;
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null
  );
}
