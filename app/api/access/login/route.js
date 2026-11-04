import { NextResponse } from 'next/server';
import { sameOrigin, deny } from '@/lib/auth';
import { loginWithCode } from '@/lib/access';
import { storeReady } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!storeReady()) return deny('서버 저장소가 연결되지 않았습니다.', 503);
  if (!sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  const { code } = await req.json().catch(() => ({}));
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  const r = await loginWithCode(req, code, res);
  if (r.ok) return res;
  if (r.locked) return deny('시도가 너무 많아 15분간 잠겼습니다.', 429);
  await new Promise((s) => setTimeout(s, 400));
  if (r.noCode) return deny('관리자가 아직 접근 암호를 설정하지 않았습니다.', 403);
  return deny(`암호가 올바르지 않습니다. (남은 시도 ${r.left}회)`, 401);
}
