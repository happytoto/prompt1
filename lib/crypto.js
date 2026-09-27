import crypto from 'node:crypto';

// 암호화 키: APP_ENCRYPTION_KEY(권장, 32자 이상 임의 문자열) → 없으면 저장소 토큰에서 파생
function masterKey() {
  const base = process.env.APP_ENCRYPTION_KEY
    || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
    || (process.env.NODE_ENV !== 'production' || process.env.HJ_ALLOW_MEMORY_STORE === '1' ? 'dev-only-insecure-key' : '');
  if (!base) throw new Error('암호화 키를 만들 수 없습니다(저장소 미연결).');
  return Buffer.from(crypto.hkdfSync('sha256', base, 'hanjul-seolgye', 'api-key-encryption-v1', 32));
}

export const encryptionSource = () => (process.env.APP_ENCRYPTION_KEY ? 'APP_ENCRYPTION_KEY' : '저장소 토큰 파생');

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decrypt(blob) {
  const [v, iv, tag, data] = String(blob).split('.');
  if (v !== 'v1') throw new Error('지원하지 않는 암호문');
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

// 비밀번호: scrypt(N=2^15) + 솔트
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), want.length, SCRYPT);
  return crypto.timingSafeEqual(want, got);
}

export const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
