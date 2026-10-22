// 管理接口合并成一个函数（Vercel Hobby 每次部署最多 12 个函数），网址不变：
//   POST /api/admin/setup             同步配置到 Vapi
//   POST /api/admin/check-forwarding  呼叫转移自测
//   POST /api/admin/blocklist         拉黑 / 取消拉黑（App 用户也用这个）
// 具体逻辑在 lib/admin/ 下，各自做鉴权。
import blocklist from '../../lib/admin/blocklist.js';
import checkForwarding from '../../lib/admin/check-forwarding.js';
import setup from '../../lib/admin/setup.js';
import { sendJson } from '../../lib/http.js';

const HANDLERS = { blocklist, 'check-forwarding': checkForwarding, setup };

export default async function handler(req, res) {
  const run = HANDLERS[req.query?.action];
  if (!run) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  await run(req, res);
}
