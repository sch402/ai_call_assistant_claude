// 电话号码工具。转移来源、Vapi 回传的号码格式可能不同（+61…、61…、sip:+61…@host、0…），
// 比较时统一取末 9 位数字：澳洲手机号去掉国家码和开头的 0 后正好 9 位，美国号码 10 位取末 9 位也足够区分。
export function digits(value) {
  if (!value) return '';
  const raw = String(value).replace(/^sips?:/i, '').split('@')[0];
  return raw.replace(/\D/g, '');
}

export function samePhone(a, b) {
  const da = digits(a);
  const db = digits(b);
  if (da.length < 6 || db.length < 6) return false;
  return da.slice(-9) === db.slice(-9);
}

// ---- 转移来源的标准化与归属 ----
// 运营商带来的转移来源（Twilio 的 ForwardedFrom）格式不统一，例如澳洲运营商会给出
// "+478558140"：去掉了开头的 0，却没有加国家码。要补全，就必须知道它属于哪个国家。
//
// 依据：Twilio 的 CalledCountry（= 我们接收转移的 Twilio 号码所在国家）。
//   转移过来的这一段，是由当地运营商打进这个号码的，所以按这个国家的编号规则解读。
// 不能用：FromCountry / CallerCountry。那是原始来电方的国家（例如国内朋友打来是 CN），
//   和"转移是从谁的号码发出的"无关。
//
// 只处理下表里明确知道编号规则的国家；其他国家一律不补全、不归属。
export const COUNTRY_RULES = {
  AU: { code: '61', nsnLengths: [9] }, // 澳洲：去掉 0 后 9 位，例如 4xx xxx xxx
  NZ: { code: '64', nsnLengths: [8, 9, 10] },
  GB: { code: '44', nsnLengths: [10] },
  US: { code: '1', nsnLengths: [10], noTrunkZero: true },
  CA: { code: '1', nsnLengths: [10], noTrunkZero: true },
};

// 按指定国家把号码整理成 E.164；无法确定时返回 null（调用方必须把 null 当作"不能归属"）。
export function toE164(value, country) {
  if (!value) return null;
  const rule = COUNTRY_RULES[String(country || '').toUpperCase()];
  if (!rule) return null;
  const d = digits(value);
  if (!d) return null;
  // 1. 已经带了本国国家码，长度也对得上
  if (d.startsWith(rule.code) && rule.nsnLengths.includes(d.length - rule.code.length)) return `+${d}`;
  // 2. 国内格式，带开头的 0（澳洲 0478 558 140）
  if (!rule.noTrunkZero && d.startsWith('0') && rule.nsnLengths.includes(d.length - 1)) {
    return `+${rule.code}${d.slice(1)}`;
  }
  // 3. 只有国内有效号码部分（澳洲运营商给的 +478558140 属于这种）
  if (rule.nsnLengths.includes(d.length) && !d.startsWith('0')) return `+${rule.code}${d}`;
  return null;
}

// 这通转移来电是否属于某个用户：两边都必须能按同一个国家整理成 E.164，且完全相等。
// 不比较末几位、不模糊匹配。多用户时还要求整个用户表里恰好只有一个人匹配（见 MVP）。
export function forwardedBelongsTo({ forwardedFrom, calledCountry, userNumber }) {
  const a = toE164(forwardedFrom, calledCountry);
  const b = toE164(userNumber, calledCountry);
  return a !== null && b !== null && a === b;
}
