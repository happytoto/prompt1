// 서버 저장소: Upstash Redis(REST) — Vercel Marketplace 연결 시 환경변수 자동 주입
// 로컬 개발에서만 메모리 저장소로 대체(운영에서는 저장소 없으면 저장 불가)
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const DEV_MEMORY = process.env.NODE_ENV !== 'production' || process.env.HJ_ALLOW_MEMORY_STORE === '1';

export const storeReady = () => Boolean(URL_ && TOKEN) || DEV_MEMORY;
export const storeKind = () => (URL_ && TOKEN ? 'redis' : DEV_MEMORY ? 'memory(dev)' : 'none');

const mem = globalThis.__hjMem || (globalThis.__hjMem = new Map());

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('저장소 오류: ' + (j.error || r.status));
  return j.result;
}

function memGet(k) {
  const e = mem.get(k);
  if (!e) return null;
  if (e.exp && e.exp < Date.now()) { mem.delete(k); return null; }
  return e.v;
}

export async function kvGet(k) {
  if (URL_ && TOKEN) return redis(['GET', k]);
  if (DEV_MEMORY) return memGet(k);
  throw new Error('저장소가 연결되지 않았습니다.');
}

export async function kvSet(k, v, ttlSec) {
  if (URL_ && TOKEN) return redis(ttlSec ? ['SET', k, v, 'EX', String(ttlSec)] : ['SET', k, v]);
  if (DEV_MEMORY) { mem.set(k, { v, exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 }); return 'OK'; }
  throw new Error('저장소가 연결되지 않았습니다.');
}

// 키가 없을 때만 저장(관리자 최초 생성 경쟁 방지)
export async function kvSetNX(k, v) {
  if (URL_ && TOKEN) return (await redis(['SET', k, v, 'NX'])) === 'OK';
  if (DEV_MEMORY) { if (memGet(k) != null) return false; mem.set(k, { v, exp: 0 }); return true; }
  throw new Error('저장소가 연결되지 않았습니다.');
}

export async function kvDel(k) {
  if (URL_ && TOKEN) return redis(['DEL', k]);
  if (DEV_MEMORY) { mem.delete(k); return 1; }
  throw new Error('저장소가 연결되지 않았습니다.');
}

export async function kvIncr(k, ttlSec) {
  if (URL_ && TOKEN) {
    const n = await redis(['INCR', k]);
    if (n === 1 && ttlSec) await redis(['EXPIRE', k, String(ttlSec)]);
    return n;
  }
  if (DEV_MEMORY) {
    const cur = Number(memGet(k) || 0) + 1;
    const e = mem.get(k);
    mem.set(k, { v: String(cur), exp: e?.exp || (ttlSec ? Date.now() + ttlSec * 1000 : 0) });
    return cur;
  }
  throw new Error('저장소가 연결되지 않았습니다.');
}
