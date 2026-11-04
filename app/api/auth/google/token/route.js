import { NextResponse } from 'next/server';
import { verifyIdToken, startGoogleAccess, NONCE_COOKIE } from '@/lib/google';
import { sameOrigin, deny, startSession, clientIp } from '@/lib/auth';
import { storeReady, kvIncr } from '@/lib/store';
import { sha256 } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
const PROD = process.env.NODE_ENV === 'production';

// 브라우저가 Google에서 받은 ID 토큰을 검증하고 세션 발급
export async function POST(req) {
  if (!storeReady()) return deny('서버 저장소가 연결되지 않았습니다.', 503);
  if (!sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  if ((await kvIncr(`hj:gtok:${sha256(clientIp(req))}`, 600)) > 30) return deny('시도가 너무 많습니다.', 429);
  const { credential } = await req.json().catch(() => ({}));
  let r;
  try { r = await verifyIdToken(credential, req.cookies.get(NONCE_COOKIE)?.value); }
  catch (e) { return deny(e.message === 'nonce' ? '로그인 시간이 지났습니다. 다시 시도하세요.' : 'Google 로그인 확인에 실패했습니다.', 401); }
  if (!r.role) return deny(`허용되지 않은 Google 계정입니다(${r.email}). 관리자에게 등록을 요청하세요.`, 403);
  const res = NextResponse.json({ ok: true, email: r.email, role: r.role }, { headers: { 'cache-control': 'no-store' } });
  res.cookies.set(NONCE_COOKIE, '', { httpOnly: true, secure: PROD, sameSite: 'strict', path: '/', maxAge: 0 });
  await startGoogleAccess(res, r.email);
  if (r.role === 'admin') await startSession(res);
  return res;
}
