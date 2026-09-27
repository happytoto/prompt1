import { NextResponse } from 'next/server';
import { sameOrigin, deny, checkPassword, startSession, clientIp } from '@/lib/auth';
import { storeReady } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) return deny('서버 저장소가 연결되지 않았습니다.', 503);
  if (!sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  const { password } = await req.json().catch(() => ({}));
  const r = await checkPassword(clientIp(req), password);
  if (r.locked) return deny('로그인 시도가 너무 많아 15분간 잠겼습니다.', 429);
  if (!r.ok) {
    await new Promise((s) => setTimeout(s, 400)); // 무차별 대입 지연
    return deny(`비밀번호가 올바르지 않습니다. (남은 시도 ${r.left}회)`, 401);
  }
  return startSession(NextResponse.json({ ok: true }));
}
