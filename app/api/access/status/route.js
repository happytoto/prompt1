import { NextResponse } from 'next/server';
import { accessOf, accessCodeSet } from '@/lib/access';
import { storeReady } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  let a = { ok: false, via: null }, codeSet = false;
  if (storeReady()) { try { a = await accessOf(req); codeSet = await accessCodeSet(); } catch { /* 저장소 오류 */ } }
  return NextResponse.json({ access: a.ok, via: a.via, codeSet }, { headers: { 'cache-control': 'no-store' } });
}
