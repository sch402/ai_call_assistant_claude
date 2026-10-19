// 给 iOS App 用的基础配置：代接号码（Twilio 号码）和机主名字。需要 DASHBOARD_TOKEN。
// 原型阶段只有一位机主；多用户时改为按登录用户返回各自的号码。
import { env } from '../lib/env.js';
import { checkDashboardToken, sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (!checkDashboardToken(req)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  sendJson(res, 200, {
    twilioNumber: env('TWILIO_PHONE_NUMBER'),
    ownerName: env('OWNER_NAME', ''),
    apiVersion: 1,
  });
}
