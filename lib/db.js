import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

let client;

// 服务端专用：使用 service role key，绕过行级安全。绝不能下发到浏览器。
export function db() {
  if (!client) {
    client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false },
    });
  }
  return client;
}
