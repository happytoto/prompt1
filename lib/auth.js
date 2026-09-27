import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvDel, kvIncr, kvSetNX, storeReady } from './store.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './crypto.js';

const PROD = process.env.NODE_ENV === 'production';
export const COOKIE = PROD ? '__Host-hj_admin' : 'hj_admin';
const SESSION_TTL = 8 * 60 * 60; // 8시간
const FAIL_LIMIT = 5;
const LOCK_SEC = 15 * 60;
const ADMIN_KEY = 'hj:admin';

// Vercel이 설정하는 x-real-ip 우선(클라이언트가 위조한 x-forwarded-for 앞부분 무시)
export const clientIp = (req) => (req.headers.get('x-real-ip') || (req.headers.get('x-forwarded-for') || 'local').split(',').pop()).trim();

// CSRF 방어: 상태 변경 요청은 같은 출처에서만
export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); }
  catch { return false; }
}

export const deny = (msg, status = 403) => NextResponse.json({ error: msg }, { status, headers: { 'cache-control': 'no-store' } });

export async function adminExists() {
  return Boolean(await kvGet(ADMIN_KEY));
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return '비밀번호는 10자 이상이어야 합니다.';
  if (pw.length > 128) return '비밀번호가 너무 깁니다.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return '영문과 숫자를 함께 사용하세요.';
  return null;
}

export async function createAdmin(pw) {
  return kvSetNX(ADMIN_KEY, JSON.stringify({ hash: hashPassword(pw), createdAt: Date.now() }));
}

export async function changePassword(pw) {
  const cur = JSON.parse((await kvGet(ADMIN_KEY)) || '{}');
  await kvSet(ADMIN_KEY, JSON.stringify({ ...cur, hash: hashPassword(pw), changedAt: Date.now() }));
}

export async function lockedFor(ip) {
  const n = Number((await kvGet(`hj:fail:${sha256(ip)}`)) || 0);
  return n >= FAIL_LIMIT;
}

export async function checkPassword(ip, pw) {
  if (await lockedFor(ip)) return { ok: false, locked: true };
  const rec = JSON.parse((await kvGet(ADMIN_KEY)) || 'null');
  const ok = Boolean(rec && typeof pw === 'string' && pw.length <= 128 && verifyPassword(pw, rec.hash));
  if (!ok) {
    const n = await kvIncr(`hj:fail:${sha256(ip)}`, LOCK_SEC);
    return { ok: false, locked: n >= FAIL_LIMIT, left: Math.max(0, FAIL_LIMIT - n) };
  }
  await kvDel(`hj:fail:${sha256(ip)}`);
  return { ok: true };
}

export async function startSession(res) {
  const token = randomToken(32);
  await kvSet(`hj:sess:${sha256(token)}`, JSON.stringify({ at: Date.now() }), SESSION_TTL);
  res.cookies.set(COOKIE, token, { httpOnly: true, secure: PROD, sameSite: 'strict', path: '/', maxAge: SESSION_TTL });
  return res;
}

export async function endSession(req, res) {
  const t = req.cookies.get(COOKIE)?.value;
  if (t) await kvDel(`hj:sess:${sha256(t)}`).catch(() => {});
  res.cookies.set(COOKIE, '', { httpOnly: true, secure: PROD, sameSite: 'strict', path: '/', maxAge: 0 });
  return res;
}

export async function isAdmin(req) {
  if (!storeReady()) return false;
  const t = req.cookies.get(COOKIE)?.value;
  if (!t || t.length < 20 || t.length > 100) return false;
  return Boolean(await kvGet(`hj:sess:${sha256(t)}`));
}

// 관리자 API 공통 가드: 로그인 + (변경 요청이면) 동일 출처
export async function guard(req, { mutate = false } = {}) {
  if (!storeReady()) return deny('서버 저장소가 연결되지 않았습니다.', 503);
  if (mutate && !sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  if (!(await isAdmin(req))) return deny('로그인이 필요합니다.', 401);
  return null;
}
