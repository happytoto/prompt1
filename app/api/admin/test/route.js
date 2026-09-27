import { NextResponse } from 'next/server';
import { guard, deny } from '@/lib/auth';
import { decryptKey, PROVIDER_IDS } from '@/lib/keys';
import { testKey } from '@/lib/router';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// 저장된 키로 실제 호출해 연결 확인(키 값은 응답에 포함하지 않음)
export async function POST(req) {
  const g = await guard(req, { mutate: true }); if (g) return g;
  const { provider, keyId } = await req.json().catch(() => ({}));
  if (!PROVIDER_IDS.includes(provider)) return deny('알 수 없는 공급사', 400);
  const key = await decryptKey(provider, keyId);
  if (!key) return deny('키를 찾을 수 없습니다.', 404);
  return NextResponse.json(await testKey(provider, key), { headers: { 'cache-control': 'no-store' } });
}
