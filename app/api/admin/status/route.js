import { NextResponse } from 'next/server';
import { isAdmin, adminExists } from '@/lib/auth';
import { storeReady, storeKind } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const ready = storeReady();
  let setupNeeded = false, loggedIn = false;
  if (ready) {
    try { setupNeeded = !(await adminExists()); loggedIn = !setupNeeded && (await isAdmin(req)); } catch { /* 저장소 오류 */ }
  }
  return NextResponse.json(
    { storeReady: ready, store: loggedIn ? storeKind() : undefined, setupNeeded, loggedIn, setupCodeRequired: Boolean(process.env.ADMIN_SETUP_CODE) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
