import { NextResponse } from 'next/server';
import { startLogin, STATE_COOKIE, originOf } from '@/lib/google';
import { storeReady } from '@/lib/store';

export const dynamic = 'force-dynamic';
const PROD = process.env.NODE_ENV === 'production';

// Google 로그인 시작: state·PKCE·nonce 생성 후 Google로 이동
export async function GET(req) {
  const back = (code) => NextResponse.redirect(`${originOf(req)}/?auth=${code}`, 303);
  if (!storeReady()) return back('nostore');
  try {
    const purpose = new URL(req.url).searchParams.get('for') === 'admin' ? 'admin' : 'app';
    const { url, state } = await startLogin(req, purpose);
    const res = NextResponse.redirect(url, 303);
    // Google에서 돌아오는 요청(다른 사이트에서 오는 이동)에도 전달되도록 Lax
    res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/', maxAge: 600 });
    res.headers.set('cache-control', 'no-store');
    return res;
  } catch {
    return back('disabled');
  }
}
