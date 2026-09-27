import { NextResponse } from 'next/server';
import { listProviders } from '@/lib/router';

export const dynamic = 'force-dynamic';

export async function GET() {
  // 키 값은 절대 노출하지 않고, 설정 여부만 반환
  return NextResponse.json({ providers: await listProviders() }, { headers: { 'cache-control': 'no-store' } });
}
