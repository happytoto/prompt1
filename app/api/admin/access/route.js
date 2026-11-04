import { NextResponse } from 'next/server';
import { guard, deny } from '@/lib/auth';
import { codeInfo, setAccessCode, trustThisDevice, listDevices, revokeDevice } from '@/lib/access';

export const dynamic = 'force-dynamic';
const H = { 'cache-control': 'no-store' };

async function state(req) {
  return { code: await codeInfo(), devices: await listDevices(req) };
}

export async function GET(req) {
  const g = await guard(req); if (g) return g;
  return NextResponse.json(await state(req), { headers: H });
}

// 접근 암호 설정 · 이 기기 등록 · 기기 해제
export async function POST(req) {
  const g = await guard(req, { mutate: true }); if (g) return g;
  const a = await req.json().catch(() => ({}));
  try {
    const res = NextResponse.json({}, { headers: H });
    let added = null;
    if (a.type === 'setCode') await setAccessCode(a.code);
    else if (a.type === 'trust') added = await trustThisDevice(a.name, res);
    else if (a.type === 'revoke') await revokeDevice(String(a.id || ''));
    else return deny('알 수 없는 동작', 400);
    // 응답 본문을 최신 상태로 교체(쿠키는 유지)
    const body = await state(req);
    if (added) body.devices = body.devices.map((d) => (d.id === added.id ? { ...d, current: true } : d));
    const out = NextResponse.json(body, { headers: H });
    for (const c of res.cookies.getAll()) out.cookies.set(c);
    return out;
  } catch (e) {
    return deny(String(e.message || e).slice(0, 200), 400);
  }
}
