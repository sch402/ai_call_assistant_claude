// 给 iOS App 登录用的公开配置：Supabase 项目地址和 anon key。不需要鉴权。
// anon key 本来就是公开的；所有表都开了行级安全且没有任何策略，拿着它读不到数据，只能走登录流程。
import { env, normalizeSupabaseUrl } from '../lib/env.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  sendJson(res, 200, {
    supabaseUrl: normalizeSupabaseUrl(env('SUPABASE_URL')),
    supabaseAnonKey: env('SUPABASE_ANON_KEY'),
  });
}
