// OmniRoute 방식 다중 AI 라우터
// - 여러 공급사 × 공급사별 여러 키(쉼표 구분)를 순서대로 시도
// - 실패한 키는 일정 시간 쿨다운(서버 인스턴스 메모리)
// - 사용자가 엔진을 고르면 그 엔진을 먼저, 실패 시 나머지로 자동 폴백
// - 모두 실패하면 규칙 기반 초안으로 최종 폴백

const DEFAULT_ORDER = ['anthropic', 'openai', 'gemini', 'openrouter', 'groq', 'custom'];
const COOLDOWN_MS = Number(process.env.KEY_COOLDOWN_MS || 60_000);
const TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 25_000);

export const PROVIDERS = {
  anthropic: {
    label: 'Claude',
    envKey: 'ANTHROPIC_API_KEY',
    model: () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    async call({ key, model, system, user, signal }) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 2000, system, messages: [{ role: 'user', content: user }] }),
      });
      const j = await readJson(r);
      return (j.content || []).map((c) => c.text || '').join('');
    },
  },
  openai: {
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o-mini',
    call: (o) => openaiCompatible('https://api.openai.com/v1/chat/completions', o, true),
  },
  gemini: {
    label: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    async call({ key, model, system, user, signal }) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2000 },
        }),
      });
      const j = await readJson(r);
      return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    },
  },
  openrouter: {
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    model: () => process.env.OPENROUTER_MODEL || 'openrouter/auto',
    call: (o) => openaiCompatible('https://openrouter.ai/api/v1/chat/completions', o, false),
  },
  groq: {
    label: 'Groq',
    envKey: 'GROQ_API_KEY',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    call: (o) => openaiCompatible('https://api.groq.com/openai/v1/chat/completions', o, true),
  },
  // 자체 게이트웨이(OmniRoute·LiteLLM 등 OpenAI 호환 엔드포인트) 연결용
  custom: {
    label: process.env.CUSTOM_LABEL || '사용자 게이트웨이',
    envKey: 'CUSTOM_API_KEY',
    model: () => process.env.CUSTOM_MODEL || 'auto',
    call: (o) => openaiCompatible((process.env.CUSTOM_BASE_URL || '').replace(/\/$/, '') + '/chat/completions', o, false),
  },
};

async function openaiCompatible(url, { key, model, system, user, signal }, jsonMode) {
  const body = { model, max_tokens: 2000, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
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

function envKeys(id) {
  if (id === 'custom' && !process.env.CUSTOM_BASE_URL) return [];
  return (process.env[PROVIDERS[id].envKey] || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const cooldown = globalThis.__hjCooldown || (globalThis.__hjCooldown = new Map());
const rr = globalThis.__hjRR || (globalThis.__hjRR = new Map());

export function providerOrder() {
  const env = (process.env.PROVIDER_ORDER || '').split(',').map((s) => s.trim()).filter((s) => PROVIDERS[s]);
  const rest = DEFAULT_ORDER.filter((p) => !env.includes(p));
  return [...env, ...rest];
}

export function listProviders() {
  return providerOrder().filter((id) => id !== 'custom' || process.env.CUSTOM_BASE_URL).map((id) => ({
    id, label: PROVIDERS[id].label, model: PROVIDERS[id].model(), configured: envKeys(id).length > 0,
  }));
}

// byok: { providerId: key } — 사용자가 기기에 저장한 개인 키(서버에 저장·로그하지 않음)
export async function routeGenerate({ engine = 'auto', byok = {}, system, user, parse }) {
  const order = providerOrder();
  const seq = engine !== 'auto' && PROVIDERS[engine] ? [engine, ...order.filter((p) => p !== engine)] : order;
  const trail = [];
  const now = Date.now();

  for (const id of seq) {
    const p = PROVIDERS[id];
    if (id === 'custom' && !process.env.CUSTOM_BASE_URL) continue;
    const personal = typeof byok[id] === 'string' && byok[id].trim() ? [byok[id].trim()] : [];
    const keys = [...personal, ...rotate(id, envKeys(id))];
    if (!keys.length) continue;

    for (const [i, key] of keys.entries()) {
      const tag = `${id}#${hash(key)}`;
      if ((cooldown.get(tag) || 0) > now) { trail.push({ provider: id, ok: false, error: '쿨다운 중' }); continue; }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const t0 = Date.now();
      try {
        const text = await p.call({ key, model: p.model(), system, user, signal: ctrl.signal });
        const result = parse(text);
        trail.push({ provider: id, ok: true, ms: Date.now() - t0, key: i < personal.length ? '개인 키' : `서버 키 ${i - personal.length + 1}` });
        return { result, provider: id, model: p.model(), trail };
      } catch (e) {
        const msg = e.name === 'AbortError' ? '시간 초과' : String(e.message || e).slice(0, 120);
        trail.push({ provider: id, ok: false, error: msg });
        // 인증·한도·서버 오류는 쿨다운(응답 파싱 실패는 쿨다운 없이 다음으로)
        if (e.status === 401 || e.status === 403 || e.status === 429 || (e.status >= 500) || e.name === 'AbortError')
          cooldown.set(tag, Date.now() + (e.status === 401 || e.status === 403 ? COOLDOWN_MS * 10 : COOLDOWN_MS));
      } finally {
        clearTimeout(timer);
      }
    }
  }
  return { result: null, provider: null, model: null, trail };
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
