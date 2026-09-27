// 민감정보 감지·마스킹 (클라이언트 경고 + 서버 이중 방어에서 공용 사용)
const RULES = [
  { type: 'API 키', re: /\bsk-ant-[A-Za-z0-9_\-]{16,}/g },
  { type: 'API 키', re: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{16,}/g },
  { type: 'API 키', re: /\bAIza[0-9A-Za-z_\-]{30,}/g },
  { type: 'API 키', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g },
  { type: 'API 키', re: /\bxox[abprs]-[A-Za-z0-9\-]{10,}/g },
  { type: 'API 키', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: 'API 키', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { type: '토큰', re: /\bBearer\s+[A-Za-z0-9._\-]{16,}/gi },
  { type: '비밀값', re: /\b(?:api[_\- ]?key|secret|token|access[_\- ]?key)\s*[:=]\s*["']?[^\s"']{6,}/gi },
  { type: '비밀번호', re: /(?:비밀번호|비번|패스워드|password|passwd|pwd)\s*(?:는|은|:|=|->)?\s*["']?[^\s"',.]{4,}/gi },
  { type: '주민등록번호', re: /\b\d{6}\s?-\s?[1-4]\d{6}\b/g },
  { type: '카드번호', re: /\b(?:\d{4}[- ]){3}\d{4}\b/g },
  { type: '전화번호', re: /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/g },
  { type: '이메일', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
];

export function detectSensitive(text = '') {
  const found = [];
  const seen = new Set();
  for (const { type, re } of RULES) {
    for (const m of text.matchAll(re)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      found.push({ type, value: m[0], preview: preview(m[0]) });
    }
  }
  return found;
}

function preview(v) {
  if (v.length <= 6) return '*'.repeat(v.length);
  return v.slice(0, 3) + '*'.repeat(Math.min(8, v.length - 5)) + v.slice(-2);
}

export function maskSensitive(text = '') {
  let out = text;
  for (const { type, re } of RULES) out = out.replace(re, `[마스킹:${type}]`);
  return out;
}
