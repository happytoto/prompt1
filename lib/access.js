// 앱 사용 권한: ① 등록된 내 기기(신뢰 쿠키, 1년) ② 관리자 로그인 ③ 접근 암호 입력(30일)
import { NextResponse } from 'next/server';
import { kvGet, kvSet, kvDel, kvIncr, storeReady } from './store.js';
import { hashPassword, verifyPassword, randomToken, sha256 } from './crypto.js';
import { isAdmin, clientIp } from './auth.js';

const PROD = process.env.NODE_ENV === 'production';
export const DEV_COOKIE = PROD ? '__Host-hj_dev' : 'hj_dev';
export const ACC_COOKIE = PROD ? '__Host-hj_acc' : 'hj_acc';
const DEV_TTL = 365 * 24 * 3600;
const ACC_TTL = 30 * 24 * 3600;
const CODE_KEY = 'hj:accesscode';     // { hash, ver, setAt }
const DEV_LIST = 'hj:devlist';        // [{ id, name, createdAt }]
const FAIL_LIMIT = 5;
const LOCK_SEC = 15 * 60;

const cookieOpts = (maxAge) => ({ httpOnly: true, secure: PROD, sameSite: 'strict', path: '/', maxAge });
const tokenOk = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 100;

async function codeRec() { return JSON.parse((await kvGet(CODE_KEY)) || 'null'); }

// 요청자가 앱을 쓸 수 있는지
export async function accessOf(req) {
  if (!storeReady()) return { ok: false, via: null };
  const dev = req.cookies.get(DEV_COOKIE)?.value;
  if (tokenOk(dev) && (await kvGet(`hj:dev:${sha256(dev)}`))) return { ok: true, via: 'device' };
  if (await isAdmin(req)) return { ok: true, via: 'admin' };
  const acc = req.cookies.get(ACC_COOKIE)?.value;
  if (tokenOk(acc)) {
    const s = JSON.parse((await kvGet(`hj:acc:${sha256(acc)}`)) || 'null');
    const rec = s && (await codeRec());
    if (s && rec && s.ver === rec.ver) return { ok: true, via: 'code' };
  }
  return { ok: false, via: null };
}

export async function requireAccess(req) {
  const a = await accessOf(req);
  if (a.ok) return null;
  return NextResponse.json({ error: '접근 암호가 필요합니다.', needAccess: true }, { status: 401, headers: { 'cache-control': 'no-store' } });
}

export async function accessCodeSet() { return Boolean(await codeRec()); }

// 접근 암호 입력(실패 5회 → 15분 잠금)
export async function loginWithCode(req, code, res) {
  const ip = sha256(clientIp(req));
  if (Number((await kvGet(`hj:afail:${ip}`)) || 0) >= FAIL_LIMIT) return { ok: false, locked: true };
  const rec = await codeRec();
  const ok = Boolean(rec && typeof code === 'string' && code.length <= 128 && verifyPassword(code, rec.hash));
  if (!ok) {
    const n = await kvIncr(`hj:afail:${ip}`, LOCK_SEC);
    return { ok: false, locked: n >= FAIL_LIMIT, left: Math.max(0, FAIL_LIMIT - n), noCode: !rec };
  }
  await kvDel(`hj:afail:${ip}`);
  const t = randomToken(32);
  await kvSet(`hj:acc:${sha256(t)}`, JSON.stringify({ ver: rec.ver, at: Date.now() }), ACC_TTL);
  res.cookies.set(ACC_COOKIE, t, cookieOpts(ACC_TTL));
  return { ok: true };
}

export function clearAccess(res) {
  res.cookies.set(ACC_COOKIE, '', cookieOpts(0));
  return res;
}

// 관리자: 접근 암호 설정(바꾸면 기존 암호 세션 모두 무효)
export async function setAccessCode(code) {
  if (typeof code !== 'string' || code.length < 1 || code.length > 64) throw new Error('접근 암호는 1~64자로 입력하세요.');
  const rec = await codeRec();
  await kvSet(CODE_KEY, JSON.stringify({ hash: hashPassword(code), ver: (rec?.ver || 0) + 1, setAt: Date.now(), len: code.length }));
}

export async function codeInfo() {
  const r = await codeRec();
  return r ? { set: true, setAt: r.setAt, weak: (r.len || 0) < 6 } : { set: false };
}

// 관리자: 지금 쓰는 기기를 '내 기기'로 등록
export async function trustThisDevice(name, res) {
  const t = randomToken(32);
  const h = sha256(t);
  const id = h.slice(0, 10);
  const dev = { id, name: String(name || '내 기기').replace(/[\u0000-\u001f]/g, '').slice(0, 40), createdAt: Date.now() };
  await kvSet(`hj:dev:${h}`, JSON.stringify(dev), DEV_TTL);
  const list = JSON.parse((await kvGet(DEV_LIST)) || '[]').filter((d) => Date.now() - d.createdAt < DEV_TTL * 1000);
  list.push({ ...dev, hash: h });
  await kvSet(DEV_LIST, JSON.stringify(list.slice(-20)));
  res.cookies.set(DEV_COOKIE, t, cookieOpts(DEV_TTL));
  return dev;
}

export async function listDevices(req) {
  const cur = req.cookies.get(DEV_COOKIE)?.value;
  const curHash = tokenOk(cur) ? sha256(cur) : '';
  const list = JSON.parse((await kvGet(DEV_LIST)) || '[]');
  const out = [];
  for (const d of list) if (await kvGet(`hj:dev:${d.hash}`)) out.push({ id: d.id, name: d.name, createdAt: d.createdAt, current: d.hash === curHash });
  return out;
}

export async function revokeDevice(id, res) {
  const list = JSON.parse((await kvGet(DEV_LIST)) || '[]');
  const d = list.find((x) => x.id === id);
  if (d) await kvDel(`hj:dev:${d.hash}`);
  await kvSet(DEV_LIST, JSON.stringify(list.filter((x) => x.id !== id)));
  return Boolean(d);
}
