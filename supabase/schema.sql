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
  attributed boolean default false,     -- 转移来源是否确认属于某位用户
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

-- 来电归属给哪位用户；为空表示运营商没带转移来源或没匹配到任何用户。
alter table public.calls add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists calls_user_id_created_at_idx on public.calls (user_id, created_at desc);

-- ---- 订阅 ----
-- 每位用户一行。原型阶段由你在 Table Editor 里手动维护；接入苹果内购后由服务端按 App Store 通知自动更新。
--   expires_at 为空 = 不过期；到期后宽限 3 天照常接听，之后来电直接拒接（lib/entitlement.js）
--   status = 'revoked'：退款或人工停用，立即失效
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'pro',
  status text not null default 'active' check (status in ('active', 'revoked')),
  expires_at timestamptz,
  source text not null default 'manual',      -- manual / app_store
  original_transaction_id text unique,         -- App Store 的原始交易号，接入内购后使用
  note text,
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

-- 苹果内购用到的字段
alter table public.subscriptions add column if not exists environment text;      -- Production / Sandbox
alter table public.subscriptions add column if not exists auto_renew boolean;    -- 用户是否关闭了自动续费
alter table public.subscriptions add column if not exists last_signed_at timestamptz;  -- 苹果签名时间，用来丢弃乱序到达的旧通知

-- ---- 每位用户的 AI 助手设置（lib/profile.js）----
-- display_name 为空 = 还没完成 App 里的首次引导；来电时没有设置的用户用默认男声、不带称呼。
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists gender text check (gender in ('male', 'female'));
alter table public.profiles add column if not exists voice_style text not null default 'mature'
  check (voice_style in ('mature', 'calm', 'young'));

-- ---- 每位用户自己的黑名单 ----
-- blocklist 是网页面板维护的全局黑名单（对所有人生效）；这里是用户在 App 里拉黑的号码，只影响打给他的电话。
create table if not exists public.user_blocks (
  user_id uuid not null references auth.users (id) on delete cascade,
  number text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, number)
);
alter table public.user_blocks enable row level security;

-- ---- 陌生号码分析缓存（lib/lookup.js）----
-- 同一个号码在有效期内不重复搜索：找到的 90 天，没找到的（result 为空）30 天。所有用户共用。
create table if not exists public.number_lookups (
  number text primary key,            -- E.164
  result jsonb,                       -- { kind, name, role, organization, confidence, sources } 或 null
  searched_at timestamptz not null default now()
);
alter table public.number_lookups enable row level security;

-- 最近一次触发搜索的用户，用来限制每人每天的新搜索次数
alter table public.number_lookups add column if not exists requested_by uuid references auth.users (id) on delete set null;
create index if not exists number_lookups_requested_by_idx on public.number_lookups (requested_by, searched_at desc);

-- ---- 推送通知（lib/push.js）----
-- App 每次启动上报 APNs 设备令牌。同一台设备换账号登录时归到新账号；苹果说令牌失效（卸载 App 等）时自动删除。
-- environment：sandbox = 从 Xcode 直接装的调试版；production = TestFlight 和 App Store 版。
create table if not exists public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  environment text not null check (environment in ('production', 'sandbox')),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
