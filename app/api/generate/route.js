import { NextResponse } from 'next/server';
import { routeGenerate } from '@/lib/router';
import { buildSystemPrompt, buildUserPrompt, parseResult, templateResult } from '@/lib/prompt';
import { maskSensitive } from '@/lib/security';
import { SECTIONS, PURPOSES } from '@/lib/sections';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// 간이 요청 제한(인스턴스 단위)
const hits = globalThis.__hjHits || (globalThis.__hjHits = new Map());
const LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 20);

export async function POST(req) {
  const ip = (req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const now = Date.now();
  const h = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  if (h.length >= LIMIT) return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' }, { status: 429 });
  h.push(now); hits.set(ip, h);

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }); }

  const input = String(body.input || '').trim().slice(0, 1000);
  if (!input) return NextResponse.json({ error: '한 줄을 입력하세요.' }, { status: 400 });
  const purpose = PURPOSES.some((p) => p.key === body.purpose) ? body.purpose : 'other';
  const answers = sanitizeMap(body.answers, 4, 300);
  const locked = sanitizeMap(body.locked, SECTIONS.length, 2000, SECTIONS.map((s) => s.key));
  const engine = String(body.engine || 'auto');

  // 서버측 이중 방어: 외부 AI로 보내기 전 민감정보 마스킹
  const safe = { input: maskSensitive(input), purpose, answers: mapVals(answers, maskSensitive), locked };

  const out = await routeGenerate({
    engine,
    system: buildSystemPrompt(),
    user: buildUserPrompt(safe),
    parse: parseResult,
  });

  let result = out.result, fallback = false;
  if (!result) { result = templateResult(safe); fallback = true; }

  // 사용자가 잠근 항목은 원문 그대로 보존
  for (const [k, v] of Object.entries(locked)) if (v) result.sections[k] = v;
  // 결과에 비밀값이 반복 노출되지 않도록
  for (const k of Object.keys(result.sections)) if (!locked[k]) result.sections[k] = maskSensitive(result.sections[k]);

  return NextResponse.json({
    ...result,
    engine: fallback ? { provider: 'template', model: '규칙 기반' } : { provider: out.provider, model: out.model },
    fallback,
    trail: out.trail,
  }, { headers: { 'cache-control': 'no-store' } });
}

function sanitizeMap(m, maxKeys, maxLen, allowed) {
  const o = {};
  if (!m || typeof m !== 'object') return o;
  for (const [k, v] of Object.entries(m).slice(0, maxKeys)) {
    if (allowed && !allowed.includes(k)) continue;
    if (typeof v === 'string') o[String(k).slice(0, 200)] = v.slice(0, maxLen);
  }
  return o;
}
const mapVals = (m, f) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, f(v)]));
