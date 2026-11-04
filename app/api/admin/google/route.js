import { NextResponse } from 'next/server';
import { guard, deny } from '@/lib/auth';
import { loadGoogle, maskGoogle, updateGoogle, redirectUri, originOf } from '@/lib/google';

export const dynamic = 'force-dynamic';
const H = { 'cache-control': 'no-store' };
const view = (g, req) => ({ ...maskGoogle(g), redirectUri: redirectUri(req), origin: originOf(req) });

export async function GET(req) {
  const g = await guard(req); if (g) return g;
  return NextResponse.json(view(await loadGoogle(), req), { headers: H });
}

export async function POST(req) {
  const g = await guard(req, { mutate: true }); if (g) return g;
  const a = await req.json().catch(() => ({}));
  try { return NextResponse.json(view(await updateGoogle(a), req), { headers: H }); }
  catch (e) { return deny(String(e.message || e).slice(0, 200), 400); }
}
