import { NextResponse } from 'next/server';
import { finishLogin, startGoogleAccess, STATE_COOKIE, originOf } from '@/lib/google';
import { startSession } from '@/lib/auth';
import { storeReady } from '@/lib/store';

export const dynamic = 'force-dynamic';
const PROD = process.env.NODE_ENV === 'production';

export async function GET(req) {
  const u = new URL(req.url);
  const go = (code, admin) => {
    const res = NextResponse.redirect(`${originOf(req)}/?auth=${code}${admin ? '&to=admin' : ''}`, 303);
    res.cookies.set(STATE_COOKIE, '', { httpOnly: true, secure: PROD, sameSite: 'lax', path: '/', maxAge: 0 });
    res.headers.set('cache-control', 'no-store');
    return res;
  };
  if (!storeReady()) return go('nostore');
  if (u.searchParams.get('error')) return go('cancel');
  let r;
  try {
    r = await finishLogin(req, {
      code: u.searchParams.get('code'),
      state: u.searchParams.get('state'),
      cookieState: req.cookies.get(STATE_COOKIE)?.value,
    });
  } catch (e) {
    return go(['state', 'expired'].includes(e.message) ? 'expired' : 'error');
  }
  if (!r.role) return go('denied');
  const res = go('ok', r.purpose === 'admin');
  await startGoogleAccess(res, r.email);
  if (r.role === 'admin') await startSession(res);
  return res;
}
