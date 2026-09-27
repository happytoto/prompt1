// 관리자 전용 AI 설정 저장: 키는 AES-256-GCM 암호화 후 저장, 화면에는 끝 4자리만 노출
import { kvGet, kvSet, storeReady } from './store.js';
import { encrypt, decrypt, randomToken } from './crypto.js';

export const PROVIDER_IDS = ['anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'custom'];
const CFG_KEY = 'hj:config';
const MAX_KEYS = 5;

const empty = () => ({ order: [], providers: {}, custom: { baseUrl: '', label: '' }, updatedAt: 0 });

export async function loadConfig() {
  if (!storeReady()) return empty();
  try { return { ...empty(), ...JSON.parse((await kvGet(CFG_KEY)) || '{}') }; }
  catch { return empty(); }
}

async function saveConfig(cfg) {
  cfg.updatedAt = Date.now();
  await kvSet(CFG_KEY, JSON.stringify(cfg));
  invalidate();
}

const P = (cfg, id) => (cfg.providers[id] ||= { enabled: true, model: '', keys: [] });

export function maskConfig(cfg) {
  return {
    order: cfg.order,
    custom: cfg.custom,
    updatedAt: cfg.updatedAt,
    providers: Object.fromEntries(PROVIDER_IDS.map((id) => {
      const p = cfg.providers[id] || { enabled: true, model: '', keys: [] };
      return [id, { enabled: p.enabled !== false, model: p.model || '', keys: (p.keys || []).map((k) => ({ id: k.id, hint: k.hint, addedAt: k.addedAt })) }];
    })),
  };
}

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);

// 관리자 동작 처리
export async function applyAction(a) {
  const cfg = await loadConfig();
  const id = a.provider;
  if (a.type !== 'setOrder' && a.type !== 'setCustom' && !PROVIDER_IDS.includes(id)) throw new Error('알 수 없는 공급사');

  switch (a.type) {
    case 'addKey': {
      const key = clean(a.key, 300);
      if (key.length < 8) throw new Error('키가 너무 짧습니다.');
      if (/\s/.test(key)) throw new Error('키에 공백이 있습니다.');
      const p = P(cfg, id);
      if (p.keys.length >= MAX_KEYS) throw new Error(`공급사당 최대 ${MAX_KEYS}개까지 등록할 수 있습니다.`);
      p.keys.push({ id: randomToken(6), enc: encrypt(key), hint: '…' + key.slice(-4), addedAt: Date.now() });
      break;
    }
    case 'removeKey': {
      const p = P(cfg, id);
      p.keys = p.keys.filter((k) => k.id !== a.keyId);
      break;
    }
    case 'setEnabled': P(cfg, id).enabled = Boolean(a.enabled); break;
    case 'setModel': P(cfg, id).model = clean(a.model, 100); break;
    case 'setOrder': {
      const o = (Array.isArray(a.order) ? a.order : []).filter((x) => PROVIDER_IDS.includes(x));
      cfg.order = [...new Set(o)];
      break;
    }
    case 'setCustom': {
      const u = clean(a.baseUrl, 300);
      if (u && !/^https:\/\//i.test(u)) throw new Error('게이트웨이 주소는 https:// 로 시작해야 합니다.');
      cfg.custom = { baseUrl: u.replace(/\/$/, ''), label: clean(a.label, 40) };
      break;
    }
    default: throw new Error('알 수 없는 동작');
  }
  await saveConfig(cfg);
  return maskConfig(cfg);
}

// 라우터용 런타임 설정(복호화) — 인스턴스 메모리 30초 캐시
let cache = { at: 0, v: null };
export function invalidate() { cache = { at: 0, v: null }; }

export async function runtimeConfig() {
  if (cache.v && Date.now() - cache.at < 30_000) return cache.v;
  const cfg = await loadConfig();
  const providers = {};
  for (const id of PROVIDER_IDS) {
    const p = cfg.providers[id] || {};
    const keys = [];
    for (const k of p.keys || []) { try { keys.push(decrypt(k.enc)); } catch { /* 키 교체 등으로 복호화 불가 → 건너뜀 */ } }
    providers[id] = { enabled: p.enabled !== false, model: p.model || '', keys };
  }
  const v = { order: cfg.order || [], custom: cfg.custom || {}, providers };
  cache = { at: Date.now(), v };
  return v;
}

export async function decryptKey(provider, keyId) {
  const cfg = await loadConfig();
  const k = (cfg.providers[provider]?.keys || []).find((x) => x.id === keyId);
  return k ? decrypt(k.enc) : null;
}
