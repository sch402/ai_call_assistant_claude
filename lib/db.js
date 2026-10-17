import { createClient } from '@supabase/supabase-js';
import { env, normalizeSupabaseUrl } from './env.js';

let client;

// 服务端专用：使用 service role key，绕过行级安全。绝不能下发到浏览器。
export function db() {
  if (!client) {
    client = createClient(normalizeSupabaseUrl(env('SUPABASE_URL')), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
  }
  return client;
}

// 数据库操作出错时写进 Vercel 日志，并把错误返回给调用方决定怎么处理。
export function logDbError(label, result) {
  if (result?.error) {
    console.error(`数据库操作失败：${label}`, result.error.message || result.error);
  }
  return result?.error || null;
}
