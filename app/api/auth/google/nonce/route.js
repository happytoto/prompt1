import { NextResponse } from 'next/server';
import { newNonce } from '@/lib/google';
import { storeReady } from '@/lib/store';

export const dynamic = 'force-dynamic';

// 'Google로 로그인' 버튼용 1회용 nonce(10분)
export async function GET() {
  if (!storeReady()) return NextResponse.json({ error: '저장소 미연결' }, { status: 503 });
  const res = NextResponse.json({}, { headers: { 'cache-control': 'no-store' } });
  const nonce = await newNonce(res);
  const out = NextResponse.json({ nonce }, { headers: { 'cache-control': 'no-store' } });
  for (const c of res.cookies.getAll()) out.cookies.set(c);
  return out;
}
