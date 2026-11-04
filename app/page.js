'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SECTIONS, PURPOSES, guessPurpose, assemblePrompt } from '@/lib/sections';
import { detectSensitive, maskSensitive } from '@/lib/security';
import { checkQuality } from '@/lib/quality';
import { DEMOS, findDemo } from '@/lib/demo';

const EXAMPLES = DEMOS.map((d) => d.input);

const LS = { hist: 'hj.history', consent: 'hj.saveConsent', engine: 'hj.engine' };
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
  const [access, setAccess] = useState(null); // { access, via, codeSet, google }
  const [authMsg, setAuthMsg] = useState(null);
  const [fullDraft, setFullDraft] = useState('');
  const [fullEdited, setFullEdited] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const pendingRef = useRef(null); // 로그인 후 이어서 실행할 생성 요청
  const resultRef = useRef(null);

  useEffect(() => {
    setHistory(lsGet(LS.hist, []));
    setEngine(lsGet(LS.engine, 'auto'));
    try { localStorage.removeItem('hj.byok'); } catch {} // 이전 버전의 기기 저장 키 제거
    // Google 로그인으로 페이지를 떠났다 돌아온 경우 입력 복원
    try {
      const d = JSON.parse(sessionStorage.getItem('hj.draft') || 'null');
      if (d) { setInput(d.input || ''); if (d.purpose) { setPurpose(d.purpose); setPurposeTouched(true); } sessionStorage.removeItem('hj.draft'); }
    } catch {}
    checkAccess();
    // Google 로그인 결과 표시 후 주소 정리
    try {
      const q = new URLSearchParams(window.location.search);
      const a = q.get('auth');
      if (a) {
        const M = { ok: 'Google 계정으로 로그인했습니다', denied: '허용되지 않은 Google 계정입니다. 관리자에게 등록을 요청하세요.', cancel: 'Google 로그인을 취소했습니다', expired: '로그인 시간이 지났습니다. 다시 시도하세요.', disabled: 'Google 로그인이 아직 설정되지 않았습니다.', nostore: '서버 저장소가 연결되지 않았습니다.', error: 'Google 로그인에 실패했습니다. 다시 시도하세요.' };
        setAuthMsg({ ok: a === 'ok', text: M[a] || M.error });
        if (q.get('to') === 'admin') setTab('admin');
        else if (a !== 'ok') setLoginOpen(true);
        else showToast(M.ok);
        window.history.replaceState(null, '', window.location.pathname);
      }
    } catch {}
  }, []);

  async function checkAccess() {
    try {
      const a = await fetch('/api/access/status', { cache: 'no-store' }).then((r) => r.json());
      setAccess(a);
      if (a.access) loadProviders();
      return a;
    } catch { setAccess({ access: false }); return { access: false }; }
  }

  // 로그인 창에서 인증 성공 → 창 닫고 대기 중이던 생성 이어서 실행
  async function afterLogin() {
    const a = await checkAccess();
    if (!a.access) return;
    setLoginOpen(false); setAuthMsg(null);
    const p = pendingRef.current; pendingRef.current = null;
    if (p) setTimeout(() => requestGenerate({ ...p, force: true }), 0);
  }

  function loadProviders() {
    fetch('/api/providers', { cache: 'no-store' }).then((r) => r.json()).then((j) => setProviders(j.providers || [])).catch(() => {});
  }

  // 전체 프롬프트: 직접 고치기 전까지는 항목 내용과 자동 동기화
  useEffect(() => { if (!fullEdited) setFullDraft(assemblePrompt(sections)); }, [sections, fullEdited]);

  const recommended = useMemo(() => guessPurpose(input), [input]);
  useEffect(() => { if (!purposeTouched) setPurpose(recommended); }, [recommended, purposeTouched]);

  const issues = useMemo(() => (result ? checkQuality(sections) : []), [sections, result]);
  const flagged = new Set(issues.filter((i) => i.level !== 'info').map((i) => i.section));

  function showToast(m) { setToast(m); setTimeout(() => setToast(''), 1800); }

  // 민감정보 확인 → 생성
  function requestGenerate({ withAnswers = false, keepLocked = false, force = false } = {}) {
    const text = input.trim();
    if (!text || loading) return;
    // 로그인 전: 예시 문구는 고정 결과물로 바로 보여 줌(AI 호출 없음)
    if (!force && !access?.access) {
      const demo = findDemo(text);
      if (demo) {
        setResult({ sections: demo.sections, questions: [], engine: { provider: 'demo', model: '예시' }, trail: [], demo: true });
        setSections(demo.sections); setLocked({}); setFullEdited(false);
        if (!purposeTouched) setPurpose(demo.purpose);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        return;
      }
    }
    // 그 외 문장은 생성할 때만 로그인 요구
    if (!force && !access?.access) { pendingRef.current = { withAnswers, keepLocked }; setLoginOpen(true); return; }
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
        body: JSON.stringify({ input: text, purpose, engine, answers: ans, locked: lockedPayload }),
      });
      const j = await r.json();
      if (j.needAccess) { setAccess((a) => ({ ...a, access: false })); pendingRef.current = { keepLocked }; setLoginOpen(true); return; }
      if (!r.ok) throw new Error(j.error || '생성 실패');
      setResult(j);
      setFullEdited(false);
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

  const fullText = () => fullDraft || assemblePrompt(sections);

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
    const item = { id: Date.now().toString(36), ts: Date.now(), input, purpose, sections, full: fullEdited ? fullDraft : undefined, engine: result?.engine };
    const next = [item, ...history].slice(0, 50);
    setHistory(next); lsSet(LS.hist, next); showToast('이 기기에 저장했습니다');
  }
  function openHistory(h) {
    setInput(h.input); setPurpose(h.purpose); setPurposeTouched(true);
    setSections(h.sections); setResult({ sections: h.sections, questions: [], engine: h.engine, trail: [], fromHistory: true });
    if (h.full) { setFullDraft(h.full); setFullEdited(true); } else setFullEdited(false);
    setLocked({}); setTab('make');
    setTimeout(() => resultRef.current?.scrollIntoView({ block: 'start' }), 50);
  }
  function removeHistory(id) { const n = history.filter((h) => h.id !== id); setHistory(n); lsSet(LS.hist, n); }
  function clearHistory() { setHistory([]); lsSet(LS.hist, []); showToast('내역을 모두 삭제했습니다'); }
  function reset() { setFullEdited(false); setResult(null); setSections({}); setLocked({}); setAnswers({}); setInput(''); setPurposeTouched(false); window.scrollTo({ top: 0 }); }

  const engineLabel = engine === 'auto' ? '자동' : (providers.find((p) => p.id === engine)?.label || engine);
  const configuredCount = providers.filter((p) => p.configured).length;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">한줄설계<small>프롬프트 1앱</small></div>
        {access?.access && (
          <button className="engine-pill" onClick={() => setTab('settings')} aria-label="AI 엔진 설정">
            엔진: {engineLabel}{configuredCount ? '' : ' · 기본'}
          </button>
        )}
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
              <div className="label">예시로 시작하기{!access?.access && <span className="note" style={{ fontWeight: 400 }}> · 로그인 없이 결과 미리보기</span>}</div>
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
                {result.demo ? <><b>예시 결과</b> · 로그인 없이 보는 고정 결과물입니다. 직접 쓴 문장은 로그인 후 AI가 설계합니다.</> : result.fromHistory ? '저장된 내역' : (
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

              <div className="card full-edit">
                <div className="sec-head">
                  <div className="sec-name">전체 프롬프트 편집</div>
                  <span className={'lock' + (fullEdited ? ' on' : '')}>{fullEdited ? '직접 수정됨' : '자동 반영'}</span>
                </div>
                <p className="note" style={{ margin: '0 0 8px' }}>AI에 붙여 넣을 최종본입니다. 여기서 고친 내용이 복사·공유·저장에 그대로 쓰입니다.</p>
                <textarea className="full" value={fullDraft} aria-label="전체 프롬프트 편집"
                  onChange={(e) => { setFullDraft(e.target.value); setFullEdited(true); }} />
                <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
                  <span className="note">{fullDraft.length.toLocaleString()}자</span>
                  {fullEdited && (
                    <button className="btn sm ghost" style={{ flex: '0 0 auto' }}
                      onClick={() => { setFullEdited(false); setFullDraft(assemblePrompt(sections)); }}>위 항목 내용으로 되돌리기</button>
                  )}
                  <button className="btn sm primary" style={{ flex: '0 0 auto' }} onClick={copy}>복사</button>
                </div>
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
          openAdmin={() => setTab('admin')} access={access}
          onLogout={async () => { try { await api('/api/access/logout', {}); } catch {} showToast('로그아웃했습니다'); checkAccess(); }} />
      )}

      {tab === 'admin' && <Admin onBack={() => setTab('settings')} onChanged={() => { checkAccess(); }} toast={showToast} google={Boolean(access?.google)} msg={authMsg} />}

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
        <NavBtn on={tab === 'settings' || tab === 'admin'} onClick={() => setTab('settings')} label="엔진 설정" d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h2M3 12h2M12 3v2M12 19v2" />
      </div></nav>

      {loginOpen && (
        <div className="sheet-bg" onClick={() => setLoginOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <Gate status={access} onOk={afterLogin} msg={authMsg}
              onGoogle={() => { try { sessionStorage.setItem('hj.draft', JSON.stringify({ input, purpose })); } catch {} }}
              openAdmin={() => { setLoginOpen(false); setTab('admin'); }} onClose={() => { setLoginOpen(false); pendingRef.current = null; }} />
          </div>
        </div>
      )}

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

function Settings({ providers, engine, setEngine, openAdmin, access, onLogout }) {
  return (
    <main>
      <h2 className="title">AI 엔진 설정</h2>
      <p className="sub">여러 AI를 순서대로 연결해, 하나가 실패하면 자동으로 다음 엔진으로 넘어갑니다. 모두 실패하면 규칙 기반 초안을 만듭니다.</p>

      <div className="card">
        <div className="field" style={{ marginTop: 0 }}>
          <label htmlFor="eng">우선 사용할 엔진</label>
          <select id="eng" value={engine} onChange={(e) => setEngine(e.target.value)}>
            <option value="auto">자동 (연결된 순서대로)</option>
            {providers.filter((p) => p.configured).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <p className="note">선택한 엔진을 먼저 쓰고, 실패하면 나머지로 자동 전환합니다.</p>
        </div>
      </div>

      <div className="label">연결 상태 · 전환 순서</div>
      <div className="card">
        {providers.length === 0 && <div className="note">{access && !access.access ? '로그인하면 연결 상태가 표시됩니다.' : '불러오는 중…'}</div>}
        {providers.map((p, i) => (
          <div key={p.id} className="prov">
            <span>{i + 1}. {p.label} <span className="note">{p.model}</span></span>
            <span className={'badge' + (p.configured ? ' ok' : '')}>{p.configured ? '연결됨' : '미연결'}</span>
          </div>
        ))}
      </div>

      <div className="label">API 키 관리</div>
      <div className="card">
        <p className="note" style={{ marginTop: 0 }}>API 키는 관리자 로그인 후 앱 안에서만 등록·삭제할 수 있습니다. 키는 서버에 암호화되어 저장되며 화면에는 끝 4자리만 표시됩니다.</p>
        <button className="btn block" style={{ marginTop: 10 }} onClick={openAdmin}>관리자 로그인</button>
      </div>

      {access && ['google', 'code'].includes(access.via) && (
        <>
          <div className="label">내 접속</div>
          <div className="card">
            <div className="prov"><span>{access.via === 'google' ? `Google · ${access.email}` : '접근 암호로 입장'}</span>
              <button className="btn sm ghost" onClick={onLogout}>로그아웃</button></div>
          </div>
        </>
      )}
    </main>
  );
}

async function api(path, body) {
  const r = await fetch(path, body === undefined
    ? { cache: 'no-store', credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || `오류 (${r.status})`); e.status = r.status; throw e; }
  return j;
}

function Admin({ onBack, onChanged, toast, google, msg }) {
  const [status, setStatus] = useState(null);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setErr('');
    try {
      const s = await api('/api/admin/status');
      setStatus(s);
      if (s.loggedIn) setData(await api('/api/admin/config'));
      else setData(null);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  async function run(fn, okMsg) {
    setBusy(true); setErr('');
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
    catch (e) {
      if (e.status === 401) { setData(null); setStatus((s) => ({ ...s, loggedIn: false })); }
      setErr(e.message);
    } finally { setBusy(false); }
  }

  const act = (a, msg) => run(async () => { const r = await api('/api/admin/config', a); setData(r); onChanged(); return r; }, msg);

  return (
    <main>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
        <button className="btn sm ghost" onClick={onBack} aria-label="뒤로">←</button>
        <h2 className="title" style={{ margin: 0 }}>관리자</h2>
      </div>
      {err && <p className="note" style={{ color: 'var(--err)' }} role="alert">{err}</p>}
      {!status && <div className="note" style={{ marginTop: 16 }}>확인 중…</div>}

      {status && !status.storeReady && (
        <div className="card" style={{ marginTop: 16 }}>
          <b>서버 저장소가 연결되지 않았습니다.</b>
          <p className="note">Vercel 프로젝트의 Storage에서 Upstash Redis를 연결한 뒤 다시 배포하면 관리자 기능이 켜집니다.</p>
        </div>
      )}

      {status?.storeReady && status.setupNeeded && (
        <PasswordForm
          title="관리자 계정 만들기"
          desc="처음 한 번만 설정합니다. 이 비밀번호로만 API 키를 관리할 수 있습니다. 영문+숫자 10자 이상."
          confirm setupCode={status.setupCodeRequired} busy={busy}
          submit="만들고 로그인"
          onSubmit={(pw, code) => run(async () => { await api('/api/admin/setup', { password: pw, setupCode: code }); await refresh(); }, '관리자 계정을 만들었습니다')}
        />
      )}

      {status?.storeReady && !status.setupNeeded && !status.loggedIn && (
        <PasswordForm title="관리자 로그인" desc="5회 실패하면 15분간 잠깁니다. 로그인은 8시간 유지됩니다." busy={busy}
          submit="로그인"
          onSubmit={(pw) => run(async () => { await api('/api/admin/login', { password: pw }); await refresh(); }, '로그인했습니다')}
        />
      )}
      {status?.storeReady && !status.setupNeeded && !status.loggedIn && google && (
        <a className="btn block google" style={{ marginTop: 12 }} href="/api/auth/google/start?for=admin"><GoogleMark /> Google 계정으로 관리자 로그인</a>
      )}
      {msg && !msg.ok && !status?.loggedIn && <p className="note" style={{ color: 'var(--err)' }} role="alert">{msg.text}</p>}

      {status?.loggedIn && data && <AdminPanel data={data} act={act} run={run} busy={busy} toast={toast}
        onLogout={() => run(async () => { await api('/api/admin/logout', {}); setData(null); await refresh(); }, '로그아웃했습니다')} />}
    </main>
  );
}

function PasswordForm({ title, desc, confirm, setupCode, busy, submit, onSubmit }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [code, setCode] = useState('');
  const mismatch = confirm && pw2 && pw !== pw2;
  return (
    <form className="card" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); if (!mismatch) onSubmit(pw, code); }}>
      <div className="sec-name">{title}</div>
      <p className="note">{desc}</p>
      {setupCode && (
        <div className="field"><label htmlFor="sc">설치 코드</label>
          <input id="sc" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></div>
      )}
      <div className="field"><label htmlFor="pw">비밀번호</label>
        <input id="pw" type="password" autoComplete={confirm ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} /></div>
      {confirm && (
        <div className="field"><label htmlFor="pw2">비밀번호 확인</label>
          <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          {mismatch && <p className="note" style={{ color: 'var(--err)' }}>비밀번호가 일치하지 않습니다.</p>}</div>
      )}
      <button className="btn primary block" style={{ marginTop: 14 }} disabled={busy || !pw || (confirm && pw !== pw2)}>{busy ? <span className="spinner" /> : submit}</button>
    </form>
  );
}

function AdminPanel({ data, act, run, busy, toast, onLogout }) {
  const { config, catalog } = data;
  const ids = [...new Set([...(config.order || []), ...Object.keys(catalog)])];
  const [draft, setDraft] = useState({});
  const [tests, setTests] = useState({});
  const [gw, setGw] = useState({ baseUrl: config.custom?.baseUrl || '', label: config.custom?.label || '' });
  const [pwOpen, setPwOpen] = useState(false);

  function move(id, d) {
    const o = [...ids]; const i = o.indexOf(id); const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    act({ type: 'setOrder', order: o });
  }
  async function test(id, keyId) {
    setTests((t) => ({ ...t, [keyId]: { loading: true } }));
    const r = await run(() => api('/api/admin/test', { provider: id, keyId }));
    setTests((t) => ({ ...t, [keyId]: r || { ok: false, error: '실패' } }));
  }

  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <div className="card">
        <div className="prov"><span>저장소</span><span className="badge ok">{data.store}</span></div>
        <div className="prov"><span>키 암호화</span><span className="badge ok">AES-256-GCM · {data.encryption}</span></div>
        <p className="note">키 값은 저장 후 다시 볼 수 없고 끝 4자리만 표시됩니다. 서버 환경변수로 넣은 키도 함께 사용됩니다.</p>
      </div>

      {ids.map((id, idx) => {
        const cat = catalog[id]; const p = config.providers[id];
        return (
          <div key={id} className="card">
            <div className="sec-head">
              <div className="sec-name"><span className="num">{idx + 1}</span>{id === 'custom' ? (config.custom?.label || cat.label) : cat.label}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn sm ghost" aria-label="위로" disabled={busy || idx === 0} onClick={() => move(id, -1)}>↑</button>
                <button className="btn sm ghost" aria-label="아래로" disabled={busy || idx === ids.length - 1} onClick={() => move(id, 1)}>↓</button>
                <button className={'lock' + (p.enabled ? ' on' : '')} disabled={busy}
                  onClick={() => act({ type: 'setEnabled', provider: id, enabled: !p.enabled })}>{p.enabled ? '사용' : '꺼짐'}</button>
              </div>
            </div>

            {id === 'custom' && (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="field" style={{ flexBasis: '100%' }}><label>게이트웨이 주소 (https)</label>
                  <input value={gw.baseUrl} placeholder="https://gateway.example.com/v1" onChange={(e) => setGw({ ...gw, baseUrl: e.target.value })} /></div>
                <div className="field"><label>표시 이름</label>
                  <input value={gw.label} placeholder="내 게이트웨이" onChange={(e) => setGw({ ...gw, label: e.target.value })} /></div>
                <button className="btn sm" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={() => act({ type: 'setCustom', ...gw }, '저장했습니다')}>저장</button>
              </div>
            )}

            <div className="field"><label>모델 (비우면 기본값)</label>
              <div className="row">
                <input defaultValue={p.model} placeholder={cat.defaultModel} onBlur={(e) => e.target.value !== p.model && act({ type: 'setModel', provider: id, model: e.target.value }, '모델을 저장했습니다')} />
              </div>
            </div>

            <div className="label" style={{ margin: '12px 0 4px' }}>등록된 키 {cat.envKeys ? <span className="note">(+ 서버 환경변수 {cat.envKeys}개)</span> : null}</div>
            {p.keys.length === 0 && <div className="note">없음</div>}
            {p.keys.map((k) => (
              <div key={k.id} className="prov">
                <span><code>{k.hint}</code> <span className="note">{new Date(k.addedAt).toLocaleDateString('ko-KR')}</span>
                  {tests[k.id] && !tests[k.id].loading && (
                    <span className="note" style={{ display: 'block', color: tests[k.id].ok ? 'var(--ok)' : 'var(--err)' }}>
                      {tests[k.id].ok ? `정상 · ${tests[k.id].ms}ms · ${tests[k.id].model}` : tests[k.id].error}
                    </span>)}
                </span>
                <span style={{ display: 'flex', gap: 4 }}>
                  <button className="btn sm" disabled={busy || tests[k.id]?.loading} onClick={() => test(id, k.id)}>{tests[k.id]?.loading ? <span className="spinner" /> : '테스트'}</button>
                  <button className="btn sm ghost" disabled={busy} onClick={() => { if (window.confirm('이 키를 삭제할까요?')) act({ type: 'removeKey', provider: id, keyId: k.id }, '삭제했습니다'); }}>삭제</button>
                </span>
              </div>
            ))}
            <form className="row" style={{ marginTop: 8 }} onSubmit={async (e) => {
              e.preventDefault();
              const r = await act({ type: 'addKey', provider: id, key: draft[id] || '' }, '키를 암호화해 저장했습니다');
              if (r) setDraft((d) => ({ ...d, [id]: '' }));
            }}>
              <input type="password" autoComplete="off" spellCheck={false} placeholder="새 API 키 붙여넣기" aria-label={`${cat.label} 새 키`}
                value={draft[id] || ''} onChange={(e) => setDraft((d) => ({ ...d, [id]: e.target.value.trim() }))}
                style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', borderRadius: 10, padding: 10, minHeight: 44 }} />
              <button className="btn sm primary" style={{ flex: '0 0 auto' }} disabled={busy || !(draft[id] || '').length}>추가</button>
            </form>
          </div>
        );
      })}

      <AccessPanel run={run} busy={busy} />

      <GooglePanel run={run} busy={busy} toast={toast} />

      <div className="card">
        <button className="btn block ghost" onClick={() => setPwOpen((v) => !v)}>비밀번호 변경</button>
        {pwOpen && <ChangePw busy={busy} onSubmit={(cur, next) => run(async () => { await api('/api/admin/config', { type: 'changePassword', current: cur, next }); setPwOpen(false); }, '비밀번호를 변경했습니다')} />}
        <button className="btn block" style={{ marginTop: 8 }} onClick={onLogout}>로그아웃</button>
      </div>
    </div>
  );
}

function ChangePw({ busy, onSubmit }) {
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (n1 === n2) onSubmit(cur, n1); }}>
      <div className="field"><label>현재 비밀번호</label><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <div className="field"><label>새 비밀번호</label><input type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} /></div>
      <div className="field"><label>새 비밀번호 확인</label><input type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} /></div>
      <button className="btn primary block" style={{ marginTop: 10 }} disabled={busy || !cur || !n1 || n1 !== n2}>변경</button>
    </form>
  );
}

// 비인증 사용자 입장 화면
function Gate({ status, onOk, openAdmin, msg, onGoogle, onClose }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!status) return <div className="note" style={{ textAlign: 'center' }}>확인 중…</div>;
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/api/access/login', { code }); setCode(''); await onOk(); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  }
  return (
    <div>
      <div className="sec-head">
        <h3>프롬프트를 만들려면 로그인하세요</h3>
        <button className="btn sm ghost" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <p className="note" style={{ marginTop: 0 }}>허용된 사용자만 생성할 수 있습니다. 한 번 로그인하면 이 기기에서 30일간 유지됩니다.</p>
      {msg && <p className="note" style={{ color: msg.ok ? 'var(--ok)' : 'var(--err)', fontSize: 14 }} role="alert">{msg.text}</p>}
      {status.google && (
        <>
          <a className="btn block google" href="/api/auth/google/start" onClick={onGoogle}><GoogleMark /> Google 계정으로 로그인</a>
          <div className="or"><span>또는 접근 암호</span></div>
        </>
      )}
      <form className="card" onSubmit={submit}>
        <div className="field" style={{ marginTop: 0 }}><label htmlFor="ac">접근 암호</label>
          <input id="ac" type="password" autoComplete="off" autoFocus value={code} onChange={(e) => setCode(e.target.value)} /></div>
        {err && <p className="note" style={{ color: 'var(--err)' }} role="alert">{err}</p>}
        <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy || !code}>{busy ? <span className="spinner" /> : '입장'}</button>
      </form>
      <button className="btn block ghost" style={{ marginTop: 12 }} onClick={openAdmin}>관리자 로그인</button>
    </div>
  );
}

function deviceName() {
  if (typeof navigator === 'undefined') return '내 기기';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return '내 iPhone';
  if (/iPad/.test(ua)) return '내 iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? '내 Android 폰' : '내 Android 태블릿';
  if (/Windows/.test(ua)) return '내 Windows PC';
  if (/Macintosh/.test(ua)) return '내 Mac';
  return '내 기기';
}

// 관리자: 접근 암호 · 내 기기 관리
function AccessPanel({ run, busy }) {
  const [st, setSt] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  useEffect(() => { setName(deviceName()); api('/api/admin/access').then(setSt).catch(() => {}); }, []);
  const act = (b, msg) => run(async () => { const r = await api('/api/admin/access', b); setSt(r); return r; }, msg);
  if (!st) return <div className="card"><div className="note">앱 접근 설정 불러오는 중…</div></div>;
  const current = st.devices.find((d) => d.current);
  return (
    <div className="card">
      <div className="sec-name">앱 접근</div>
      <p className="note">등록한 내 기기는 인증 없이 바로 쓰고, 그 외 사람은 접근 암호를 입력해야 합니다.</p>

      <div className="label" style={{ margin: '12px 0 4px' }}>내 기기 (인증 없이 사용)</div>
      {st.devices.length === 0 && <div className="note">등록된 기기 없음</div>}
      {st.devices.map((d) => (
        <div key={d.id} className="prov">
          <span>{d.name}{d.current && <span className="badge ok" style={{ marginLeft: 6 }}>이 기기</span>}
            <span className="note" style={{ display: 'block' }}>{new Date(d.createdAt).toLocaleDateString('ko-KR')} 등록</span></span>
          <button className="btn sm ghost" disabled={busy} onClick={() => { if (window.confirm(`'${d.name}' 등록을 해제할까요?`)) act({ type: 'revoke', id: d.id }, '기기 등록을 해제했습니다'); }}>해제</button>
        </div>
      ))}
      {!current && (
        <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); act({ type: 'trust', name }, '이 기기를 내 기기로 등록했습니다'); }}>
          <input value={name} onChange={(e) => setName(e.target.value)} aria-label="기기 이름" maxLength={40}
            style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', borderRadius: 10, padding: 10, minHeight: 44 }} />
          <button className="btn sm primary" style={{ flex: '0 0 auto' }} disabled={busy}>이 기기 등록</button>
        </form>
      )}

      <div className="label" style={{ margin: '16px 0 4px' }}>접근 암호 (다른 사람용)</div>
      <div className="note">{st.code.set ? `설정됨 · ${new Date(st.code.setAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}` : '미설정 — 지금은 내 기기·관리자만 사용할 수 있습니다.'}</div>
      {st.code.set && st.code.weak && <div className="note" style={{ color: 'var(--warn)' }}>짧은 암호는 추측되기 쉽습니다. 6자 이상을 권장합니다.</div>}
      <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); act({ type: 'setCode', code }, '접근 암호를 저장했습니다. 기존 입장 기록은 모두 만료됩니다.').then((r) => r && setCode('')); }}>
        <input type="password" autoComplete="new-password" value={code} placeholder={st.code.set ? '새 접근 암호' : '접근 암호 정하기'} onChange={(e) => setCode(e.target.value)} aria-label="접근 암호"
          style={{ border: '1px solid var(--line)', background: 'var(--surface-2)', borderRadius: 10, padding: 10, minHeight: 44 }} />
        <button className="btn sm primary" style={{ flex: '0 0 auto' }} disabled={busy || !code}>저장</button>
      </form>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

// 관리자: Google 로그인 설정
function GooglePanel({ run, busy, toast }) {
  const [g, setG] = useState(null);
  const [f, setF] = useState({ clientId: '', clientSecret: '', adminEmails: '', userEmails: '' });
  const load = (v) => { setG(v); setF({ clientId: v.clientId || '', clientSecret: '', adminEmails: (v.adminEmails || []).join('\n'), userEmails: (v.userEmails || []).join('\n') }); };
  useEffect(() => { api('/api/admin/google').then(load).catch(() => {}); }, []);
  if (!g) return <div className="card"><div className="note">Google 로그인 설정 불러오는 중…</div></div>;
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast('복사했습니다'); } catch {} };
  const save = () => run(async () => {
    const body = { clientId: f.clientId, adminEmails: f.adminEmails, userEmails: f.userEmails };
    if (f.clientSecret) body.clientSecret = f.clientSecret;
    load(await api('/api/admin/google', body));
  }, 'Google 로그인 설정을 저장했습니다');
  const ta = { width: '100%', minHeight: 72, border: '1px solid var(--line)', background: 'var(--surface-2)', borderRadius: 10, padding: 10, fontSize: 14, resize: 'vertical', outline: 0 };
  return (
    <div className="card">
      <div className="sec-head">
        <div className="sec-name">Google 로그인</div>
        <span className={'badge' + (g.enabled ? ' ok' : '')}>{g.enabled ? '사용 중' : '미설정'}</span>
      </div>
      <p className="note">관리자 이메일은 관리자 권한, 허용 이메일은 앱 사용 권한을 받습니다. 목록에서 지우면 즉시 차단됩니다.</p>

      <div className="label" style={{ margin: '12px 0 4px' }}>Google Cloud에 등록할 값</div>
      <div className="prov"><span className="note" style={{ wordBreak: 'break-all' }}>승인된 자바스크립트 원본<br /><code>{g.origin}</code></span>
        <button className="btn sm ghost" onClick={() => copy(g.origin)}>복사</button></div>
      <div className="prov"><span className="note" style={{ wordBreak: 'break-all' }}>승인된 리디렉션 URI<br /><code>{g.redirectUri}</code></span>
        <button className="btn sm ghost" onClick={() => copy(g.redirectUri)}>복사</button></div>

      <div className="field"><label htmlFor="gcid">클라이언트 ID</label>
        <input id="gcid" value={f.clientId} placeholder="…apps.googleusercontent.com" onChange={(e) => setF({ ...f, clientId: e.target.value.trim() })} /></div>
      <div className="field"><label htmlFor="gcs">클라이언트 보안 비밀 {g.secretHint && <span className="note">(저장됨 {g.secretHint})</span>}</label>
        <input id="gcs" type="password" autoComplete="off" value={f.clientSecret} placeholder={g.secretHint ? '바꿀 때만 입력' : 'GOCSPX-…'} onChange={(e) => setF({ ...f, clientSecret: e.target.value.trim() })} /></div>
      <div className="field"><label htmlFor="gad">관리자 이메일 (줄바꿈·쉼표로 구분)</label>
        <textarea id="gad" style={ta} value={f.adminEmails} placeholder="나@gmail.com" onChange={(e) => setF({ ...f, adminEmails: e.target.value })} /></div>
      <div className="field"><label htmlFor="gus">허용 사용자 이메일</label>
        <textarea id="gus" style={ta} value={f.userEmails} placeholder="friend@gmail.com" onChange={(e) => setF({ ...f, userEmails: e.target.value })} /></div>
      <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy} onClick={save}>저장</button>
      {!g.enabled && <p className="note">클라이언트 ID·보안 비밀·관리자 이메일 1개 이상이 모두 있어야 로그인 버튼이 나타납니다.</p>}
    </div>
  );
}
