// 生成 Twilio 的 TwiML。手写而不是用 SDK 的 builder，便于单元测试，也让返回内容一目了然。
export function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function response(inner) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

// 把来电桥接到 Vapi 的 SIP 地址。
// Twilio 会把 SIP URI 上以 X- 开头的查询参数作为自定义 SIP 头发出，
// 用来把我们这边的 CallSid 带给 Vapi，方便事后把通话报告对上号。
export function dialVapi({ sipUri, headers = {}, timeLimitSeconds = 300 }) {
  const params = Object.entries(headers)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const uri = params ? `${sipUri}?${params}` : sipUri;
  return response(
    `<Dial answerOnBridge="true" timeLimit="${timeLimitSeconds}"><Sip>${xmlEscape(uri)}</Sip></Dial>`
  );
}

export function sayAndHangup(text, language = 'en-AU') {
  return response(`<Say language="${xmlEscape(language)}">${xmlEscape(text)}</Say><Hangup/>`);
}

export function reject() {
  return response('<Reject reason="busy"/>');
}

export function pause(seconds) {
  return response(`<Pause length="${Number(seconds) || 30}"/>`);
}
