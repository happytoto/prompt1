'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SECTIONS, PURPOSES, guessPurpose, assemblePrompt } from '@/lib/sections';
import { detectSensitive, maskSensitive } from '@/lib/security';
import { checkQuality } from '@/lib/quality';

const EXAMPLES = [
  '골프 초보를 위한 드라이버 슬라이스 교정 쇼츠 대본 써줘',
  '월별 매출 엑셀을 분석해서 줄어든 원인을 찾아줘',
  '반려견 산책 앱 소개용 썸네일 이미지를 만들고 싶어',
];

const LS = { hist: 'hj.history', consent: 'hj.saveConsent', engine: 'hj.engine', byok: 'hj.byok' };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const NEED_RE = /\[확인 필요[:：]?\s*([^\]]*)\]/g;

export default function Page() {
  const [tab, setTab] = useState('make');
  const [input, setInput] = useState('');
  const [purpose, setPurpose] = useState('other');
  const [purposeTouched, setPurposeTouched] = useState(false);
  const [engine, setEngine] = useState('auto');
  const [providers, setProviders] = useState([]);
  const [byok, setByok] = useState({});
  const [result, setResult] = useState(null);
  const [sections, setSections] = useState({});
  const [locked, setLocked] = useState({});
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sens, setSens] = useState(null); // { items, run }
  const [consentSheet, setConsentSheet] = useState(false);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState('');
  const resultRef = useRef(null);

  useEffect(() => {
    setHistory(lsGet(LS.hist, []));
    setEngine(lsGet(LS.engine, 'auto'));
    setByok(lsGet(LS.byok, {}));
    fetch('/api/providers').then((r) => r.json()).then((j) => setProviders(j.providers || [])).catch(() => {});
  }, []);

  const recommended = useMemo(() => guessPurpose(input), [input]);
  useEffect(() => { if (!purposeTouched) setPurpose(recommended); }, [recommended, purposeTouched]);

  const issues = useMemo(() => (result ? checkQuality(sections) : []), [sections, result]);
  const flagged = new Set(issues.filter((i) => i.level !== 'info').map((i) => i.section));

  function showToast(m) { setToast(m); setTimeout(() => setToast(''), 1800); }

  // 민감정보 확인 → 생성
  function requestGenerate({ withAnswers = false, keepLocked = false } = {}) {
    const text = input.trim();
    if (!text || loading) return;
    const ans = withAnswers ? answers : {};
    const found = detectSensitive([text, ...Object.values(ans)].join('\n'));
    const run = (mask) => generate({
      text: mask ? maskSensitive(text) : text,
      ans: mask ? Object.fromEntries(Object.entries(ans).map(([k, v]) => [k, maskSensitive(v)])) : ans,
      keepLocked,
      maskedInput: mask,
    });
    if (found.length) setSens({ items: found, run });
    else run(false);
  }

  async function generate({ text, ans, keepLocked, maskedInput }) {
    setSens(null);
    if (maskedInput) setInput(text);
    setLoading(true); setError('');
    const lockedPayload = keepLocked ? Object.fromEntries(Object.keys(locked).filter((k) => locked[k]).map((k) => [k, sections[k]])) : {};
    try {
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: text, purpose, engine, answers: ans, locked: lockedPayload, byok }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '생성 실패');
      setResult(j);
      setSections(j.sections);
      if (!keepLocked) setLocked({});
      if (Object.keys(ans).length) setAnswers({});
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (e) {
      setError(e.message || '네트워크 오류');
    } finally {
      setLoading(false);
    }
  }

  function editSection(k, v) {
    setSections((s) => ({ ...s, [k]: v }));
    setLocked((l) => ({ ...l, [k]: true }));
  }

  const fullText = () => assemblePrompt(sections);

  async function copy() {
    const t = fullText();
    try { await navigator.clipboard.writeText(t); }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {} ta.remove();
    }
    showToast('프롬프트를 복사했습니다');
  }
  async function share() {
    const t = fullText();
    if (navigator.share) { try { await navigator.share({ title: '한줄설계 프롬프트', text: t }); } catch {} }
    else { await copy(); }
  }
  function save() {
    if (!lsGet(LS.consent, false)) { setConsentSheet(true); return; }
    doSave();
  }
  function doSave() {
    const item = { id: Date.now().toString(36), ts: Date.now(), input, purpose, sections, engine: result?.engine };
    const next = [item, ...history].slice(0, 50);
    setHistory(next); lsSet(LS.hist, next); showToast('이 기기에 저장했습니다');
  }
  function openHistory(h) {
    setInput(h.input); setPurpose(h.purpose); setPurposeTouched(true);
    setSections(h.sections); setResult({ sections: h.sections, questions: [], engine: h.engine, trail: [], fromHistory: true });
    setLocked({}); setTab('make');
    setTimeout(() => resultRef.current?.scrollIntoView({ block: 'start' }), 50);
  }
  function removeHistory(id) { const n = history.filter((h) => h.id !== id); setHistory(n); lsSet(LS.hist, n); }
  function clearHistory() { setHistory([]); lsSet(LS.hist, []); showToast('내역을 모두 삭제했습니다'); }
  function reset() { setResult(null); setSections({}); setLocked({}); setAnswers({}); setInput(''); setPurposeTouched(false); window.scrollTo({ top: 0 }); }

  const engineLabel = engine === 'auto' ? '자동' : (providers.find((p) => p.id === engine)?.label || engine);
  const configuredCount = providers.filter((p) => p.configured || byok[p.id]).length;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">한줄설계<small>프롬프트 1앱</small></div>
        <button className="engine-pill" onClick={() => setTab('settings')} aria-label="AI 엔진 설정">
          엔진: {engineLabel}{configuredCount ? '' : ' · 기본'}
        </button>
      </header>

      {tab === 'make' && (
        <main>
          <h2 className="title">하고 싶은 일을<br />한 줄로 적어 주세요</h2>
          <p className="sub">역할·맥락·입력·처리·출력·검증·보안을 갖춘 프롬프트로 바꿔 드립니다.</p>

          <div className="card">
            <textarea
              className="main" value={input} maxLength={500}
              placeholder="예) 신제품 출시 안내 메일을 고객에게 보내고 싶어"
              onChange={(e) => setInput(e.target.value)}
              aria-label="한 줄 입력"
            />
            <div className="counter">{input.length}/500</div>
          </div>

          {!input && !result && (
            <>
              <div className="label">예시로 시작하기</div>
              {EXAMPLES.map((ex) => <button key={ex} className="ex" onClick={() => setInput(ex)}>{ex}</button>)}
            </>
          )}

          <div className="label">용도</div>
          <div className="chips" role="radiogroup" aria-label="용도">
            {PURPOSES.map((p) => (
              <button key={p.key} role="radio" aria-checked={purpose === p.key}
                className={'chip' + (purpose === p.key ? ' on' : '')}
                onClick={() => { setPurpose(p.key); setPurposeTouched(true); }}>
                {p.label}{input && recommended === p.key && <span className="rec">추천</span>}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            <button className="btn primary block" disabled={!input.trim() || loading} onClick={() => requestGenerate()}>
              {loading ? <><span className="spinner" /> 설계하는 중…</> : (result ? '새로 설계하기' : '프롬프트 설계하기')}
            </button>
            {error && <p className="note" style={{ color: 'var(--err)', marginTop: 8 }}>{error}</p>}
          </div>

          {loading && !result && (
            <div className="stack" style={{ marginTop: 20 }}>{SECTIONS.slice(0, 4).map((s) => <div key={s.key} className="skeleton" />)}</div>
          )}

          {result && (
            <section ref={resultRef} className="stack" style={{ marginTop: 24, scrollMarginTop: 70 }}>
              <div className="trail">
                {result.fromHistory ? '저장된 내역' : (
                  <>생성 엔진: <b>{result.engine?.provider === 'template' ? '규칙 기반(오프라인)' : `${labelOf(providers, result.engine?.provider)} · ${result.engine?.model}`}</b>
                    {result.trail?.some((t) => !t.ok) && <> · 자동 전환 {result.trail.filter((t) => !t.ok).length}회</>}
                    {result.fallback && <> · AI 연결 실패 또는 미설정으로 템플릿 초안</>}
                  </>
                )}
              </div>

              {result.questions?.length > 0 && (
                <div className="card qa stack">
                  <div className="sec-name">더 정확하게 만들기 <span className="sec-hint">(건너뛰어도 됩니다)</span></div>
                  {result.questions.map((q) => (
                    <div key={q.q}>
                      <div className="q">{q.q}</div>
                      {q.why && <div className="why">{q.why}</div>}
                      <input value={answers[q.q] || ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.q]: e.target.value }))} placeholder="답변 입력" />
                    </div>
                  ))}
                  <div className="row">
                    <button className="btn ghost" onClick={() => setResult((r) => ({ ...r, questions: [] }))}>건너뛰기</button>
                    <button className="btn primary" disabled={loading || !Object.values(answers).some((v) => v?.trim())}
                      onClick={() => requestGenerate({ withAnswers: true, keepLocked: true })}>반영해 다시 생성</button>
                  </div>
                </div>
              )}

              {SECTIONS.map((s, i) => {
                const val = sections[s.key] || '';
                const needs = [...val.matchAll(NEED_RE)].map((m) => m[1] || '내용');
                return (
                  <div key={s.key} className={'card sec' + (flagged.has(s.key) ? ' flag' : '')}>
                    <div className="sec-head">
                      <div className="sec-name"><span className="num">{i + 1}</span>{s.label}<span className="sec-hint">{s.hint}</span></div>
                      <button className={'lock' + (locked[s.key] ? ' on' : '')}
                        onClick={() => setLocked((l) => ({ ...l, [s.key]: !l[s.key] }))}
                        aria-pressed={!!locked[s.key]}
                        title="고정된 항목은 재생성해도 유지됩니다">
                        {locked[s.key] ? '고정됨' : '고정'}
                      </button>
                    </div>
                    <AutoText value={val} onChange={(v) => editSection(s.key, v)} label={s.label} />
                    {needs.length > 0 && (
                      <div className="needs">{needs.map((n, j) => <span key={j} className="need">확인 필요 · {n}</span>)}</div>
                    )}
                  </div>
                );
              })}

              <div className="card">
                <div className="sec-name" style={{ marginBottom: 6 }}>품질 점검</div>
                {issues.length === 0
                  ? <div className="okline">누락·모순이 발견되지 않았습니다. 실제 AI에 붙여 넣어 결과를 확인해 보세요.</div>
                  : issues.map((it, j) => (
                    <div key={j} className="issue">
                      <span className={'dot ' + it.level} />
                      <div>
                        <div>{it.section ? <b>{SECTIONS.find((s) => s.key === it.section)?.label} · </b> : null}{it.msg}</div>
                        <div className="fix">{it.fix}</div>
                      </div>
                    </div>
                  ))}
                <p className="note" style={{ marginTop: 8 }}>자동 점검은 형식 누락·모순만 확인하며, 결과의 정확성을 보증하지 않습니다.</p>
              </div>

              <div className="row">
                <button className="btn" disabled={loading} onClick={() => requestGenerate({ keepLocked: true })}>
                  {loading ? <span className="spinner" /> : '전체 재생성'}
                </button>
                <button className="btn ghost" onClick={reset}>처음으로</button>
              </div>
              <p className="note">직접 고친 항목은 자동으로 ‘고정’되어 재생성해도 유지됩니다.</p>
            </section>
          )}
        </main>
      )}

      {tab === 'history' && (
        <main>
          <h2 className="title">최근 생성 내역</h2>
          <p className="sub">이 기기의 브라우저에만 보관됩니다. 서버에는 저장하지 않습니다.</p>
          {history.length === 0 ? <div className="empty">저장한 프롬프트가 없습니다.</div> : (
            <>
              {history.map((h) => (
                <div key={h.id} className="hist-item" role="button" tabIndex={0} onClick={() => openHistory(h)} onKeyDown={(e) => e.key === 'Enter' && openHistory(h)}>
                  <div className="t">{h.input}</div>
                  <div className="m" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{PURPOSES.find((p) => p.key === h.purpose)?.label} · {new Date(h.ts).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                    <button className="btn sm ghost" style={{ minHeight: 28, padding: '0 8px' }} onClick={(e) => { e.stopPropagation(); removeHistory(h.id); }}>삭제</button>
                  </div>
                </div>
              ))}
              <button className="btn block ghost" style={{ marginTop: 16 }} onClick={clearHistory}>내역 모두 삭제</button>
            </>
          )}
        </main>
      )}

      {tab === 'settings' && (
        <Settings providers={providers} engine={engine} setEngine={(e) => { setEngine(e); lsSet(LS.engine, e); }}
          byok={byok} setByok={(b) => { setByok(b); lsSet(LS.byok, b); }} />
      )}

      {tab === 'make' && result && (
        <div className="actionbar"><div className="inner">
          <button className="btn primary" onClick={copy}>복사</button>
          <button className="btn" onClick={share}>공유</button>
          <button className="btn" onClick={save}>저장</button>
          <button className="btn" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="위로">↑</button>
        </div></div>
      )}

      <nav className="nav"><div className="inner">
        <NavBtn on={tab === 'make'} onClick={() => setTab('make')} label="만들기" d="M12 5v14M5 12h14" />
        <NavBtn on={tab === 'history'} onClick={() => setTab('history')} label="내역" d="M4 6h16M4 12h16M4 18h10" />
        <NavBtn on={tab === 'settings'} onClick={() => setTab('settings')} label="엔진 설정" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h2M3 12h2M12 3v2M12 19v2" />
      </div></nav>

      {sens && (
        <div className="sheet-bg" onClick={() => setSens(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>민감정보가 감지되었습니다</h3>
            <p className="note">AI로 보내기 전에 가리는 것을 권장합니다. 서버에서도 한 번 더 가린 뒤 전송합니다.</p>
            {sens.items.map((it, i) => <div key={i} className="sens"><span>{it.type}</span><code>{it.preview}</code></div>)}
            <div className="stack" style={{ marginTop: 16 }}>
              <button className="btn primary block" onClick={() => sens.run(true)}>가리고 생성</button>
              <button className="btn block" onClick={() => sens.run(false)}>그대로 진행</button>
              <button className="btn ghost block" onClick={() => setSens(null)}>취소</button>
            </div>
          </div>
        </div>
      )}

      {consentSheet && (
        <div className="sheet-bg" onClick={() => setConsentSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>이 기기에 보관할까요?</h3>
            <p className="note" style={{ fontSize: 14 }}>
              입력한 한 줄과 생성된 프롬프트를 <b>이 브라우저에만</b> 저장합니다(최대 50개). 서버나 다른 기기로 전송하지 않으며, ‘내역’에서 언제든 삭제할 수 있습니다. 공용 기기라면 저장하지 마세요.
            </p>
            <div className="stack" style={{ marginTop: 16 }}>
              <button className="btn primary block" onClick={() => { lsSet(LS.consent, true); setConsentSheet(false); doSave(); }}>동의하고 저장</button>
              <button className="btn ghost block" onClick={() => setConsentSheet(false)}>저장 안 함</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function labelOf(providers, id) { return providers.find((p) => p.id === id)?.label || id; }

function AutoText({ value, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = Math.max(60, el.scrollHeight + 2) + 'px';
  }, [value]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} rows={2} />;
}

function NavBtn({ on, onClick, label, d }) {
  return (
    <button className={on ? 'on' : ''} onClick={onClick} aria-current={on ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
      {label}
    </button>
  );
}

function Settings({ providers, engine, setEngine, byok, setByok }) {
  const [draft, setDraft] = useState(byok);
  useEffect(() => setDraft(byok), [byok]);
  return (
    <main>
      <h2 className="title">AI 엔진 설정</h2>
      <p className="sub">여러 AI를 순서대로 연결해, 하나가 실패하면 자동으로 다음 엔진으로 넘어갑니다. 모두 실패하면 규칙 기반 초안을 만듭니다.</p>

      <div className="card">
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="eng">우선 사용할 엔진</label>
          <select id="eng" value={engine} onChange={(e) => setEngine(e.target.value)}>
            <option value="auto">자동 (연결된 순서대로)</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.configured || byok[p.id] ? '' : ' (키 없음)'}</option>)}
          </select>
          <p className="note">선택한 엔진을 먼저 쓰고, 실패하면 나머지로 자동 전환합니다.</p>
        </div>
      </div>

      <div className="label">연결 상태 · 전환 순서</div>
      <div className="card">
        {providers.length === 0 && <div className="note">불러오는 중…</div>}
        {providers.map((p, i) => (
          <div key={p.id} className="prov">
            <span>{i + 1}. {p.label} <span className="note">{p.model}</span></span>
            <span className={'badge' + (p.configured || byok[p.id] ? ' ok' : '')}>
              {p.configured ? '서버 키' : byok[p.id] ? '개인 키' : '미연결'}
            </span>
          </div>
        ))}
      </div>

      <div className="label">개인 API 키 (선택)</div>
      <div className="card">
        <p className="note" style={{ marginTop: 0 }}>서버 키가 없거나 본인 키를 우선 쓰고 싶을 때 입력합니다. 이 브라우저에만 저장되고, 생성 요청 시에만 HTTPS로 전송되며 서버에 저장·기록하지 않습니다. 공용 기기에서는 입력하지 마세요.</p>
        {providers.map((p) => (
          <div key={p.id} className="field">
            <label htmlFor={'k-' + p.id}>{p.label}</label>
            <input id={'k-' + p.id} type="password" autoComplete="off" spellCheck={false}
              value={draft[p.id] || ''} placeholder="비워 두면 사용 안 함"
              onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value.trim() }))} />
          </div>
        ))}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn ghost" onClick={() => { setByok({}); setDraft({}); }}>모두 지우기</button>
          <button className="btn primary" onClick={() => setByok(Object.fromEntries(Object.entries(draft).filter(([, v]) => v)))}>저장</button>
        </div>
      </div>
    </main>
  );
}
