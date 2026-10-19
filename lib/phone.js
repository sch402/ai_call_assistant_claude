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

// 把运营商给的号码整理成 E.164。澳洲运营商的转移来源可能少了国家码，例如
// "+478558140"（去掉了 0，却没加 61）或 "0478558140"，统一补成 "+61478558140"。
// 无法判断的格式原样返回。
export function toE164AU(value) {
  if (!value) return value ?? null;
  const d = digits(value);
  if (d.startsWith('61') && d.length === 11) return `+${d}`;
  if (d.length === 10 && d.startsWith('0')) return `+61${d.slice(1)}`;
  if (d.length === 9 && /^[23478]/.test(d)) return `+61${d}`;
  return String(value).trim();
}
