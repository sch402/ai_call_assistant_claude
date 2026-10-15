import { env } from './env.js';

const API = 'https://api.vapi.ai';

export async function vapi(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('VAPI_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`Vapi ${method} ${path} 失败（${res.status}）：${detail}`);
  }
  return data;
}

// 列表接口在不同版本里可能直接返回数组，也可能包在 results 里。
export function asList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}
