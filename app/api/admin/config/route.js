import { NextResponse } from 'next/server';
import { guard, deny, validatePassword, changePassword, checkPassword, clientIp } from '@/lib/auth';
import { loadConfig, maskConfig, applyAction } from '@/lib/keys';
import { PROVIDERS } from '@/lib/router';
import { storeKind } from '@/lib/store';
import { encryptionSource } from '@/lib/crypto';

export const dynamic = 'force-dynamic';
const H = { 'cache-control': 'no-store' };

function meta() {
  return {
    store: storeKind(),
    encryption: encryptionSource(),
    catalog: Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [id, {
      label: p.label, defaultModel: process.env[p.envModel] || p.defaultModel,
      envKeys: (process.env[p.envKey] || '').split(',').filter((s) => s.trim()).length,
    }])),
  };
}

export async function GET(req) {
  const g = await guard(req); if (g) return g;
  return NextResponse.json({ config: maskConfig(await loadConfig()), ...meta() }, { headers: H });
}

export async function POST(req) {
  const g = await guard(req, { mutate: true }); if (g) return g;
  const a = await req.json().catch(() => ({}));
  try {
    if (a.type === 'changePassword') {
      const chk = await checkPassword(clientIp(req), a.current);
      if (!chk.ok) return deny(chk.locked ? '시도가 너무 많아 잠겼습니다.' : '현재 비밀번호가 올바르지 않습니다.', chk.locked ? 429 : 401);
      const err = validatePassword(a.next); if (err) return deny(err, 400);
      await changePassword(a.next);
      return NextResponse.json({ ok: true }, { headers: H });
    }
    const config = await applyAction(a);
    return NextResponse.json({ config, ...meta() }, { headers: H });
  } catch (e) {
    return deny(String(e.message || e).slice(0, 200), 400);
  }
}
