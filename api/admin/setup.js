// 一键初始化 / 同步配置（可重复执行）：
//   1. 在 Vapi 创建或更新模板助理，校验配置是否有效
//   2. 在 Vapi 创建 SIP 接入号（sip:<用户名>@sip.vapi.ai），来电时向 /api/vapi-webhook 要这位用户的助理配置
//   3. 把 Twilio 号码的来电 webhook 指向本服务
import twilio from 'twilio';
import { ASSISTANT_NAME_IN_VAPI } from '../../lib/assistant.js';
import { assistantForProfile } from '../../lib/profile.js';
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
    // 1. 模板助理：用默认设置创建或更新，只为让 Vapi 校验配置是否有效（有错这里就会报出来）。
    //    来电时并不用它，而是每通电话按用户设置临时生成（见 /api/vapi-webhook 的 assistant-request）。
    const config = assistantForProfile(null);
    const assistants = asList(await vapi('GET', '/assistant?limit=100'));
    const existing = assistants.find((a) => a.name === ASSISTANT_NAME_IN_VAPI);
    const assistant = existing
      ? await vapi('PATCH', `/assistant/${existing.id}`, config)
      : await vapi('POST', '/assistant', config);
    steps.push(`配置校验通过（${existing ? '已更新' : '已创建'}模板助理 ${assistant.id}）`);

    // 2. SIP 接入号：不绑定固定助理，来电时 Vapi 向我们的服务要配置（assistant-request）
    const uri = sipUri();
    const routing = {
      assistantId: null,
      server: { url: `${baseUrl()}/api/vapi-webhook`, secret: env('VAPI_WEBHOOK_SECRET') },
    };
    const numbers = asList(await vapi('GET', '/phone-number?limit=100'));
    const sipNumber = numbers.find((n) => n.sipUri === uri);
    if (sipNumber) {
      await vapi('PATCH', `/phone-number/${sipNumber.id}`, routing);
      steps.push(`SIP 接入号已存在，来电时按用户设置生成助理：${uri}`);
    } else {
      const created = await vapi('POST', '/phone-number', {
        provider: 'vapi',
        sipUri: uri,
        name: 'AI Call Assistant SIP',
        ...routing,
      });
      steps.push(`已创建 SIP 接入号 ${created.id}，来电时按用户设置生成助理：${uri}`);
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
