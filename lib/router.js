// OmniRoute 방식 다중 AI 라우터
// - 키 출처: ① 관리자 화면에서 등록한 키(암호화 저장) ② 서버 환경변수(쉼표로 여러 개)
// - 공급사 × 여러 키를 순서대로 시도, 실패 키는 쿨다운, 모두 실패 시 규칙 기반 초안
import { runtimeConfig, PROVIDER_IDS } from './keys.js';

const COOLDOWN_MS = Number(process.env.KEY_COOLDOWN_MS || 60_000);
const TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 25_000);

export const PROVIDERS = {
  anthropic: {
    label: 'Claude', envKey: 'ANTHROPIC_API_KEY', envModel: 'ANTHROPIC_MODEL', defaultModel: 'claude-sonnet-4-5',
    async call({ key, model, system, user, signal, maxTokens }) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
      });
      const j = await readJson(r);
      return (j.content || []).map((c) => c.text || '').join('');
    },
  },
  openai: {
    label: 'OpenAI', envKey: 'OPENAI_API_KEY', envModel: 'OPENAI_MODEL', defaultModel: 'gpt-4o-mini',
    call: (o) => openaiCompatible('https://api.openai.com/v1/chat/completions', o, true),
  },
  gemini: {
    label: 'Gemini', envKey: 'GEMINI_API_KEY', envModel: 'GEMINI_MODEL', defaultModel: 'gemini-3.8-flash',
    async call({ key, model, system, user, signal, maxTokens }) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens },
        }),
      });
      const j = await readJson(r);
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },
  openrouter: {
    label: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', envModel: 'OPENROUTER_MODEL', defaultModel: 'openrouter/auto',
    call: (o) => openaiCompatible('https://openrouter.ai/api/v1/chat/completions', o, false),
  },
  groq: {
    label: 'Groq', envKey: 'GROQ_API_KEY', envModel: 'GROQ_MODEL', defaultModel: 'openai/gpt-oss-120b',
    // Groq JSON 모드는 추론 모델에서 검증 실패가 잦아 끄고, 응답에서 JSON을 추출
    call: (o) => openaiCompatible('https://api.groq.com/openai/v1/chat/completions', o, false),
  },
  // 자체 게이트웨이(OmniRoute·LiteLLM 등 OpenAI 호환)
  custom: {
    label: '사용자 게이트웨이', envKey: 'CUSTOM_API_KEY', envModel: 'CUSTOM_MODEL', defaultModel: 'auto',
    call: (o) => openaiCompatible(o.baseUrl + '/chat/completions', o, false),
  },
};

async function openaiCompatible(url, { key, model, system, user, signal, maxTokens }, jsonMode) {
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const j = await readJson(r);
  return j.choices?.[0]?.message?.content || '';
}

async function readJson(r) {
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 160);
    try { const j = JSON.parse(text); msg = j.error?.message || j.error?.type || msg; } catch {}
    const e = new Error(`HTTP ${r.status}: ${msg}`);
    e.status = r.status;
    throw e;
  }
  return JSON.parse(text);
}

const envKeys = (id) => (process.env[PROVIDERS[id].envKey] || '').split(',').map((s) => s.trim()).filter(Boolean);

// 공급사별 실행 정보 계산
function resolve(id, rc) {
  const p = PROVIDERS[id];
  const c = rc.providers[id] || {};
  const baseUrl = id === 'custom' ? String(rc.custom?.baseUrl || process.env.CUSTOM_BASE_URL || '').replace(/\/$/, '') : '';
  return {
    id,
    label: id === 'custom' ? (rc.custom?.label || process.env.CUSTOM_LABEL || p.label) : p.label,
    model: c.model || process.env[p.envModel] || p.defaultModel,
    enabled: c.enabled !== false && (id !== 'custom' || Boolean(baseUrl)),
    keys: [...(c.keys || []), ...envKeys(id)],
    baseUrl,
  };
}

async function order() {
  const rc = await runtimeConfig();
  const env = (process.env.PROVIDER_ORDER || '').split(',').map((s) => s.trim());
  const pref = (rc.order?.length ? rc.order : env).filter((s) => PROVIDERS[s]);
  const ids = [...new Set([...pref, ...PROVIDER_IDS])];
  return { rc, ids };
}

// 공개용: 키 값·개수 없이 사용 가능 여부만
export async function listProviders() {
  const { rc, ids } = await order();
  return ids.map((id) => resolve(id, rc)).filter((r) => r.enabled)
    .map((r) => ({ id: r.id, label: r.label, model: r.model, configured: r.keys.length > 0 }));
}

const cooldown = globalThis.__hjCooldown || (globalThis.__hjCooldown = new Map());
const rr = globalThis.__hjRR || (globalThis.__hjRR = new Map());

export async function routeGenerate({ engine = 'auto', system, user, parse }) {
  const { rc, ids } = await order();
  const seq = engine !== 'auto' && PROVIDERS[engine] ? [engine, ...ids.filter((p) => p !== engine)] : ids;
  const trail = [];
  const now = Date.now();

  for (const id of seq) {
    const r = resolve(id, rc);
    if (!r.enabled || !r.keys.length) continue;
    const keys = rotate(id, r.keys);
    for (const [i, key] of keys.entries()) {
      const tag = `${id}#${hash(key)}`;
      if ((cooldown.get(tag) || 0) > now) { trail.push({ provider: id, ok: false, error: '쿨다운 중' }); continue; }
      const t0 = Date.now();
      try {
        const text = await callOnce(id, r, key, system, user, TIMEOUT_MS, 2000);
        const result = parse(text);
        trail.push({ provider: id, ok: true, ms: Date.now() - t0, key: `키 ${i + 1}` });
        return { result, provider: id, model: r.model, trail };
      } catch (e) {
        const msg = e.name === 'AbortError' ? '시간 초과' : String(e.message || e).slice(0, 120);
        trail.push({ provider: id, ok: false, error: msg });
        if (e.status === 401 || e.status === 403 || e.status === 429 || e.status >= 500 || e.name === 'AbortError')
          cooldown.set(tag, Date.now() + (e.status === 401 || e.status === 403 ? COOLDOWN_MS * 10 : COOLDOWN_MS));
      }
    }
  }
  return { result: null, provider: null, model: null, trail };
}

async function callOnce(id, r, key, system, user, timeout, maxTokens) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await PROVIDERS[id].call({ key, model: r.model, system, user, signal: ctrl.signal, maxTokens, baseUrl: r.baseUrl });
  } finally { clearTimeout(timer); }
}

// 관리자 화면의 '연결 테스트'
export async function testKey(id, key) {
  const { rc } = await order();
  const r = resolve(id, rc);
  if (id === 'custom' && !r.baseUrl) return { ok: false, error: '게이트웨이 주소가 없습니다.' };
  const t0 = Date.now();
  try {
    const text = await callOnce(id, r, key, 'Reply with the JSON {"ok":true} only.', 'ping', 20_000, 300);
    return { ok: true, ms: Date.now() - t0, model: r.model, sample: String(text).slice(0, 40) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? '시간 초과' : String(e.message || e).slice(0, 160), model: r.model };
  }
}

function rotate(id, keys) {
  if (keys.length < 2) return keys;
  const n = (rr.get(id) || 0) % keys.length;
  rr.set(id, n + 1);
  return [...keys.slice(n), ...keys.slice(0, n)];
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
