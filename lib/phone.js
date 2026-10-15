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
