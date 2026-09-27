import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sameOrigin, deny, adminExists, validatePassword, createAdmin, startSession, clientIp } from '@/lib/auth';
import { storeReady, kvIncr } from '@/lib/store';
import { sha256 } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

// 최초 1회 관리자 생성. ADMIN_SETUP_CODE가 설정돼 있으면 코드도 확인
export async function POST(req) {
  if (!storeReady()) return deny('서버 저장소가 연결되지 않았습니다.', 503);
  if (!sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  if ((await kvIncr(`hj:setup:${sha256(clientIp(req))}`, 3600)) > 10) return deny('시도가 너무 많습니다.', 429);
  if (await adminExists()) return deny('이미 관리자가 있습니다. 로그인하세요.', 409);

  const { password, setupCode } = await req.json().catch(() => ({}));
  const need = process.env.ADMIN_SETUP_CODE;
  if (need) {
    const a = Buffer.from(sha256(String(setupCode || ''))), b = Buffer.from(sha256(need));
    if (!crypto.timingSafeEqual(a, b)) return deny('설치 코드가 올바르지 않습니다.');
  }
  const err = validatePassword(password);
  if (err) return deny(err, 400);
  if (!(await createAdmin(password))) return deny('이미 관리자가 있습니다.', 409);
  return startSession(NextResponse.json({ ok: true }));
}
