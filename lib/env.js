// 读取环境变量。缺失时抛出明确的错误，方便在 Vercel 日志里定位。
export function env(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`缺少环境变量 ${name}，请在 Vercel 项目设置里添加`);
  }
  return value;
}

// 对外访问的网址，例如 https://ai-call-assistant.vercel.app（末尾不带 /）
// 没写协议时自动补 https://（例如只填了 xxx.vercel.app）。
export function normalizeBaseUrl(value) {
  let url = String(value).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/^http:\/\//i, 'https://');
}

export function baseUrl() {
  return normalizeBaseUrl(env('PUBLIC_BASE_URL'));
}

export function sipUri() {
  return `sip:${env('VAPI_SIP_USERNAME')}@sip.vapi.ai`;
}
