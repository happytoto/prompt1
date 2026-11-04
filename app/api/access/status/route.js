import { NextResponse } from 'next/server';
import { accessOf, accessCodeSet } from '@/lib/access';
import { storeReady } from '@/lib/store';
import { loadGoogle, isEnabled } from '@/lib/google';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  let a = { ok: false, via: null }, codeSet = false, google = false, googleClientId;
  if (storeReady()) { try { a = await accessOf(req); codeSet = await accessCodeSet(); const g = await loadGoogle(); google = isEnabled(g); if (google) googleClientId = g.effClientId; } catch { /* 저장소 오류 */ } }
  return NextResponse.json({ access: a.ok, via: a.via, email: a.email, codeSet, google, googleClientId }, { headers: { 'cache-control': 'no-store' } });
}
