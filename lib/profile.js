// 用户的 AI 助手设置（存在 profiles 表）：
//   display_name  称呼。AI 对正常来电方说 "this is <称呼>'s AI assistant"
//   gender        male / female，决定男声还是女声
//   voice_style   mature / calm / young（成熟 / 稳重 / 年轻）
// 首次登录时 App 引导用户填称呼和性别；音色默认「成熟」，可在「我的」里改。
import {
  assistantConfig,
  DEFAULT_GENDER,
  DEFAULT_VOICE_STYLE,
  GENDERS,
  VOICE_STYLES,
} from './assistant.js';
import { baseUrl, env } from './env.js';

export const NAME_MAX_LENGTH = 30;
// 称呼会写进这位用户自己助理的系统提示词，所以只允许名字里常见的字符：任何语言的字母、空格、点、撇号、连字符。
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;

export const PROFILE_FIELDS = 'user_id,phone,display_name,gender,voice_style';

export function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || [...name].length > NAME_MAX_LENGTH || !NAME_PATTERN.test(name)) return null;
  return name;
}

// App 提交的修改：{ name?, gender?, voiceStyle? }，只改传了的字段。
// 返回 { update }（数据库字段）或 { error }。
export function validateProfileUpdate(body = {}) {
  const update = {};
  if (body.name !== undefined) {
    const name = normalizeName(body.name);
    if (!name) return { error: `称呼需要 1 到 ${NAME_MAX_LENGTH} 个字，只能包含文字、空格和 . ' -` };
    update.display_name = name;
  }
  if (body.gender !== undefined) {
    if (!GENDERS.includes(body.gender)) return { error: '性别只能是 male 或 female' };
    update.gender = body.gender;
  }
  if (body.voiceStyle !== undefined) {
    if (!VOICE_STYLES.includes(body.voiceStyle)) return { error: `音色只能是 ${VOICE_STYLES.join(' / ')}` };
    update.voice_style = body.voiceStyle;
  }
  if (!Object.keys(update).length) return { error: '没有要修改的内容' };
  return { update };
}

// 返回给 App 的形式。complete = 首次引导已完成（称呼和性别都填了）。
export function profileView(row) {
  return {
    name: row?.display_name || null,
    gender: row?.gender || null,
    voiceStyle: row?.voice_style || DEFAULT_VOICE_STYLE,
    complete: Boolean(row?.display_name && row?.gender),
  };
}

// 这位用户的助理配置。row 为空（找不到用户）时用默认设置，不带称呼。
export function assistantForProfile(row) {
  return assistantConfig({
    ownerName: row?.display_name || '',
    gender: row?.gender || DEFAULT_GENDER,
    voiceStyle: row?.voice_style || DEFAULT_VOICE_STYLE,
    serverUrl: `${baseUrl()}/api/vapi-webhook`,
    webhookSecret: env('VAPI_WEBHOOK_SECRET'),
    maxCallSeconds: Number(env('MAX_CALL_SECONDS', '300')),
  });
}
