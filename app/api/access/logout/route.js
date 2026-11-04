import { NextResponse } from 'next/server';
import { sameOrigin, deny } from '@/lib/auth';
import { clearAccess } from '@/lib/access';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  return clearAccess(NextResponse.json({ ok: true }));
}
