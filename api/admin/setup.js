// 一键初始化 / 同步配置（可重复执行）：
//   1. 在 Vapi 创建或更新语音助理
//   2. 在 Vapi 创建 SIP 接入号（sip:<用户名>@sip.vapi.ai），并绑定到助理
//   3. 把 Twilio 号码的来电 webhook 指向本服务
import twilio from 'twilio';
import { assistantConfig, ASSISTANT_NAME_IN_VAPI } from '../../lib/assistant.js';
import { env, baseUrl, sipUri } from '../../lib/env.js';
import { checkDashboardToken, sendJson } from '../../lib/http.js';
import { asList, vapi } from '../../lib/vapi.js';
import { samePhone } from '../../lib/phone.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  if (!checkDashboardToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  const steps = [];
  try {
    // 1. 助理
    const config = assistantConfig({
      // 机主的名字（来电方认识你时用的名字，例如英文名）。助理自己没有名字，需要自我介绍时说 "<OWNER_NAME>'s AI assistant"。
      ownerName: env('OWNER_NAME', ''),
      voice: env('ASSISTANT_VOICE', 'male-mature'),
      serverUrl: `${baseUrl()}/api/vapi-webhook`,
      webhookSecret: env('VAPI_WEBHOOK_SECRET'),
      maxCallSeconds: Number(env('MAX_CALL_SECONDS', '300')),
    });
    const assistants = asList(await vapi('GET', '/assistant?limit=100'));
    const existing = assistants.find((a) => a.name === ASSISTANT_NAME_IN_VAPI);
    const assistant = existing
      ? await vapi('PATCH', `/assistant/${existing.id}`, config)
      : await vapi('POST', '/assistant', config);
    steps.push(`${existing ? '已更新' : '已创建'} Vapi 助理 ${assistant.id}`);

    // 2. SIP 接入号
    const uri = sipUri();
    const numbers = asList(await vapi('GET', '/phone-number?limit=100'));
    const sipNumber = numbers.find((n) => n.sipUri === uri);
    if (sipNumber) {
      await vapi('PATCH', `/phone-number/${sipNumber.id}`, { assistantId: assistant.id });
      steps.push(`SIP 接入号已存在，已绑定到助理：${uri}`);
    } else {
      const created = await vapi('POST', '/phone-number', {
        provider: 'vapi',
        sipUri: uri,
        assistantId: assistant.id,
        name: 'AI Call Assistant SIP',
      });
      steps.push(`已创建 SIP 接入号 ${created.id}：${uri}`);
    }

    // 3. Twilio 来电 webhook
    const client = twilio(env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'));
    const ourNumber = env('TWILIO_PHONE_NUMBER');
    const owned = await client.incomingPhoneNumbers.list({ phoneNumber: ourNumber, limit: 5 });
    const twilioNumber = owned.find((n) => samePhone(n.phoneNumber, ourNumber));
    if (!twilioNumber) {
      throw new Error(`在 Twilio 账号里找不到号码 ${ourNumber}，请检查 TWILIO_PHONE_NUMBER`);
    }
    const voiceUrl = `${baseUrl()}/api/twilio-voice`;
    await client.incomingPhoneNumbers(twilioNumber.sid).update({ voiceUrl, voiceMethod: 'POST' });
    steps.push(`Twilio 号码 ${twilioNumber.phoneNumber} 的来电已指向 ${voiceUrl}`);

    sendJson(res, 200, { ok: true, steps });
  } catch (err) {
    sendJson(res, 500, { ok: false, steps, error: err.message });
  }
}
