-- 在 Supabase 控制台 › SQL Editor 里整段运行一次即可。
-- 所有表开启行级安全且不建任何策略：只有服务端（service role key）能读写，浏览器拿不到数据。

create extension if not exists pgcrypto;

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  call_sid text unique,                 -- Twilio 来电 ID
  from_number text,                     -- 来电方号码
  to_number text,                       -- 我们的 Twilio 号码
  forwarded_from text,                  -- 运营商带来的转移来源（可能为空）
  attributed boolean default false,     -- 转移来源是否确认等于机主号码
  stir_verstat text,                    -- 来电号码认证结果（美国运营商才有）
  caller_country text,
  status text,                          -- answering / completed / blocked
  vapi_call_id text,
  match_method text,                    -- call_sid / caller_time / unmatched
  ended_reason text,
  duration_seconds numeric,
  summary text,                         -- 中文摘要
  structured jsonb,                     -- 结构化字段：身份、来意、类别、诈骗风险等
  transcript text,
  messages jsonb,
  raw_params jsonb,
  raw_report jsonb
);
create index if not exists calls_created_at_idx on public.calls (created_at desc);

create table if not exists public.forward_tests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  call_sid text,
  forwarded_from text,
  matched_owner boolean,
  raw_params jsonb
);

create table if not exists public.blocklist (
  number text primary key,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.calls enable row level security;
alter table public.forward_tests enable row level security;
alter table public.blocklist enable row level security;

-- ---- App 用户（手机号 + 短信验证码登录，由 Supabase Auth 管理）----
-- 已经建过上面几张表的项目，重新整段运行一次即可：都是 if not exists。

-- 用户第一次调用接口时由服务端写入（lib/auth.js）。phone 是验证过的登录手机号（E.164），
-- 来电 webhook 用它和运营商带来的转移来源比对，唯一约束保证一个号码只归属一位用户。
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- 来电归属给哪位用户；为空表示运营商没带转移来源或没匹配到用户（原型阶段算机主的）。
alter table public.calls add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists calls_user_id_created_at_idx on public.calls (user_id, created_at desc);
