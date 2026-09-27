import { NextResponse } from 'next/server';
import { sameOrigin, deny, endSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!sameOrigin(req)) return deny('허용되지 않은 요청 출처입니다.');
  return endSession(req, NextResponse.json({ ok: true }));
}
