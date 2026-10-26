// App Store 截图和审核演示账号共用的示例来电。
// 号码都用 ACMA 保留给影视作品的虚构号码（0491 570 xxx、02 5550 xxxx），不会打到真人。
// 人名、公司名都是虚构的。

export const DEMO_LOGIN = '+61491570006'; // 审核用的 Supabase 测试手机号，验证码见 fastlane/metadata/review_information
export const DEMO_PROFILE = { display_name: 'Charlie', gender: 'female', voice_style: 'calm' };

// minutesAgo：距现在多少分钟；relative：截图里列表右侧显示的相对时间
export const DEMO_CALLS = [
  {
    key: 'dental',
    minutesAgo: 3,
    relative: '3分钟前',
    clock: '10月26日 下午2:38',
    from: '+61255501234',
    duration: 48,
    structured: {
      caller_name: 'Sarah',
      organization: 'City Dental',
      purpose: '确认周五上午 10 点的洗牙预约',
      callback_number: '02 5550 1234',
      deadline: '周四下午 5 点前',
      category: 'business',
      urgency: 'medium',
      scam_risk: 3,
      scam_reasons: [],
      language: 'en',
      recommended_action: 'call_back',
      summary_zh: 'City Dental 的 Sarah 来电，确认你周五上午 10 点的洗牙预约，请在周四下午 5 点前回电确认能否到诊。',
    },
    transcript:
      'Caller: Hi, this is Sarah from City Dental, calling about an appointment on Friday.\n' +
      "AI: Hi Sarah, this is Charlie's AI assistant. Charlie can't take the call right now. What's it regarding?\n" +
      'Caller: Just confirming the 10am clean on Friday. Could she call us back by 5pm Thursday?\n' +
      "AI: Of course. Is 02 5550 1234 the best number?\n" +
      'Caller: Yes, that\'s us. Thanks!\n' +
      "AI: Thanks Sarah, I'll pass that on. Bye!",
  },
  {
    key: 'scam',
    minutesAgo: 41,
    relative: '41分钟前',
    clock: '10月26日 下午2:00',
    from: '+61491570156',
    duration: 37,
    structured: {
      caller_name: '自称「中国大使馆」',
      organization: '',
      purpose: '称你有包裹涉嫌违法，要求转接「警方」并转账',
      category: 'scam',
      urgency: 'high',
      scam_risk: 92,
      scam_reasons: ['冒充使领馆', '以包裹涉嫌违法施压', '要求转账或提供银行信息'],
      language: 'zh',
      recommended_action: 'block',
      summary_zh: '自称「中国大使馆」，称你有一个包裹涉嫌违法，要求转接「警方」并转账。典型冒充使领馆诈骗，AI 已结束通话。',
    },
    transcript:
      '来电方：您好，这里是中国大使馆，您有一个包裹被海关扣押，涉嫌违法。\n' +
      'AI：您好，我是 Charlie 的 AI 助手。请问您的姓名和回电号码？\n' +
      '来电方：现在马上给您转接警方，需要您配合核实银行账户……\n' +
      'AI：抱歉，我无法提供任何账户信息。再见。',
  },
  {
    key: 'agent',
    minutesAgo: 95,
    relative: '1小时前',
    clock: '10月26日 下午1:06',
    from: '+61491570157',
    duration: 29,
    structured: {
      caller_name: '',
      organization: '',
      purpose: '询问你是否考虑出售房产，想约时间做免费估价',
      callback_number: '',
      category: 'business',
      urgency: 'low',
      scam_risk: 8,
      scam_reasons: [],
      language: 'en',
      recommended_action: 'ignore',
      summary_zh: '对方没有说明身份，询问你是否考虑出售房产，想约时间上门做免费估价。不急，可以忽略。',
    },
    lookup: {
      kind: 'person',
      name: 'Daniel Lee',
      role: '房产中介',
      organization: 'Harbour Realty',
      confidence: 88,
      sources: ['https://www.harbourrealty.com.au/agents/daniel-lee'],
    },
    transcript:
      "Caller: Hi, just wondering if you've thought about selling the property this year?\n" +
      "AI: Hi, this is Charlie's AI assistant. May I ask who's calling?\n" +
      "Caller: Just a local agent, we're doing free appraisals in the area.\n" +
      "AI: Thanks, I'll let Charlie know. Bye!",
  },
  {
    key: 'solar',
    minutesAgo: 190,
    relative: '3小时前',
    clock: '10月26日 上午11:31',
    from: '+61491570158',
    duration: 22,
    structured: {
      caller_name: 'Mike',
      organization: 'Bright Solar',
      purpose: '推销太阳能板和电池',
      category: 'telemarketing',
      urgency: 'low',
      scam_risk: 15,
      scam_reasons: [],
      language: 'en',
      recommended_action: 'ignore',
      summary_zh: 'Bright Solar 的 Mike 推销太阳能板和家用电池，称有政府补贴。AI 已礼貌结束通话。',
    },
    transcript:
      "Caller: Hi, it's Mike from Bright Solar, there are new government rebates for solar and batteries.\n" +
      "AI: Thanks Mike. Charlie isn't interested at the moment. Have a good day!",
  },
  {
    key: 'school',
    minutesAgo: 60 * 22,
    relative: '昨天',
    clock: '10月25日 下午4:12',
    from: '+61255504321',
    duration: 54,
    structured: {
      caller_name: 'Ms Wilson',
      organization: 'Greenfield Primary School',
      purpose: '孩子明天的校外活动同意书还没交',
      callback_number: '02 5550 4321',
      deadline: '明天上午 9 点前',
      category: 'business',
      urgency: 'high',
      scam_risk: 2,
      scam_reasons: [],
      language: 'en',
      recommended_action: 'call_back',
      summary_zh: 'Greenfield Primary 的 Wilson 老师来电：孩子明天的校外活动同意书还没交，需要在明天上午 9 点前签好或回电。',
    },
    transcript:
      "Caller: Hello, this is Ms Wilson from Greenfield Primary. We haven't received the excursion form for tomorrow.\n" +
      "AI: Hi Ms Wilson, this is Charlie's AI assistant. When is it needed by?\n" +
      'Caller: By 9am tomorrow please, or she can call the office on 02 5550 4321.\n' +
      "AI: Got it, I'll pass that on right away. Thank you!",
  },
  {
    key: 'robocall',
    minutesAgo: 60 * 26,
    relative: '昨天',
    clock: '10月25日 中午12:20',
    from: '+61491570159',
    duration: 14,
    structured: {
      caller_name: '',
      organization: '',
      purpose: '自动语音：称你的税务账户有问题，按 1 转人工',
      category: 'robocall',
      urgency: 'low',
      scam_risk: 64,
      scam_reasons: ['自动语音冒充税务机构'],
      language: 'en',
      recommended_action: 'block',
      summary_zh: '自动语音录音，称你的税务账户有问题，要求按 1 转人工。疑似冒充 ATO 的机器人外呼，建议拉黑。',
    },
    transcript: 'Caller (recording): This is an urgent message about your tax file. Press 1 to speak to an officer.',
  },
];

// 把示例来电写成审核演示账号用的 SQL（node ios/appstore/demo-data.mjs > supabase/review-demo.sql）
function sql(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function reviewDemoSql() {
  const login = DEMO_LOGIN.slice(1);
  const lines = [
    '-- App 审核演示账号：示例来电和 AI 助手设置。由 ios/appstore/demo-data.mjs 生成，不要手改。',
    '-- 用法：先在 Supabase › Authentication › Providers › Phone 里加测试号码 ' + login + '（验证码 246810），',
    '-- 用这个号码在 App 里登录一次（创建用户），再在 SQL Editor 里运行本文件。可以重复运行，每次都会重置示例数据。',
    '-- 演示账号故意不开订阅，审核人员可以用沙盒账号测试购买。',
    'do $$',
    'declare uid uuid;',
    'begin',
    `  select id into uid from auth.users where phone = ${sql(login)};`,
    "  if uid is null then raise exception '先用 " + login + " 在 App 里登录一次'; end if;",
    '',
    `  update public.profiles set display_name = ${sql(DEMO_PROFILE.display_name)}, gender = ${sql(DEMO_PROFILE.gender)},`,
    `    voice_style = ${sql(DEMO_PROFILE.voice_style)} where user_id = uid;`,
    '  delete from public.calls where user_id = uid;',
    '  delete from public.subscriptions where user_id = uid;',
  ];
  for (const call of DEMO_CALLS) {
    lines.push(
      '  insert into public.calls (user_id, created_at, call_sid, from_number, to_number, forwarded_from, attributed, status,',
      '    match_method, ended_reason, duration_seconds, summary, structured, transcript) values (',
      `    uid, now() - interval '${call.minutesAgo} minutes', ${sql('demo-' + call.key)}, ${sql(call.from)}, '+61258496666',`,
      `    ${sql(DEMO_LOGIN)}, true, 'completed', 'call_sid', 'customer-ended-call', ${call.duration},`,
      `    ${sql(call.structured.summary_zh)}, ${sql(JSON.stringify(call.structured))}::jsonb, ${sql(call.transcript)})`,
      '  on conflict (call_sid) do update set user_id = excluded.user_id, created_at = excluded.created_at;',
    );
    if (call.lookup) {
      lines.push(
        `  insert into public.number_lookups (number, result, searched_at) values (${sql(call.from)}, ${sql(JSON.stringify(call.lookup))}::jsonb, now())`,
        '  on conflict (number) do update set result = excluded.result, searched_at = excluded.searched_at;',
      );
    }
  }
  lines.push('end $$;', '');
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(reviewDemoSql());
