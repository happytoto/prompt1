import { SECTIONS, PURPOSES } from './sections.js';

export function buildSystemPrompt() {
  return `당신은 프롬프트 설계 전문가입니다. 사용자가 한 줄로 적은 요청을 AI 도구에 그대로 붙여 넣을 수 있는 구조화 프롬프트로 바꿉니다.

반드시 아래 JSON 객체 하나만 출력하세요(코드 블록·설명 금지).
{
  "sections": {
    "role": "역할",
    "context": "맥락(배경·대상·목적)",
    "input": "입력(AI가 받을 자료·조건)",
    "process": "처리(단계별 작업 규칙, 번호 목록)",
    "output": "출력(형식·분량·톤을 구체적으로)",
    "verify": "검증(결과 점검 기준 체크리스트)",
    "security": "보안(민감정보 취급·금지사항)"
  },
  "questions": [{"q": "질문", "why": "결과에 미치는 영향"}]
}

규칙:
1. 7개 항목을 모두 한국어로 채웁니다. 각 항목은 짧고 구체적으로(1~6줄).
2. 사용자가 주지 않은 사실(이름, 수치, 날짜, 제품명 등)은 지어내지 말고 "[확인 필요: 무엇]"으로 표시합니다.
3. questions는 결과 품질에 큰 영향을 주는 것만 최대 2개. 필요 없으면 빈 배열.
4. "locked"로 받은 항목은 한 글자도 바꾸지 말고 그대로 넣습니다.
5. 비밀번호·API 키·개인정보는 결과에 반복하지 말고 "[마스킹됨]"으로 둡니다.
6. "정확성 보장", "100% 정확" 같은 표현을 쓰지 않습니다. 검증 항목에는 근거 제시·자기 점검 기준을 넣습니다.
7. 사용자의 추가 답변(answers)이 있으면 반영하고 해당 [확인 필요]를 해소합니다.`;
}

export function buildUserPrompt({ input, purpose, answers, locked }) {
  const p = PURPOSES.find((x) => x.key === purpose)?.label || '기타';
  const parts = [`요청(한 줄): ${input}`, `용도: ${p}`];
  const a = Object.entries(answers || {}).filter(([, v]) => v && v.trim());
  if (a.length) parts.push('추가 답변:\n' + a.map(([q, v]) => `- ${q} → ${v}`).join('\n'));
  const l = Object.entries(locked || {}).filter(([, v]) => v && v.trim());
  if (l.length) parts.push('locked(그대로 유지):\n' + JSON.stringify(Object.fromEntries(l), null, 2));
  return parts.join('\n\n');
}

// LLM 응답에서 JSON 추출·정규화
export function parseResult(text) {
  if (!text) throw new Error('빈 응답');
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('JSON 없음');
  const obj = JSON.parse(s.slice(a, b + 1));
  const src = obj.sections || obj;
  const sections = {};
  for (const { key } of SECTIONS) {
    const v = src[key];
    sections[key] = Array.isArray(v) ? v.join('\n') : String(v ?? '').trim();
  }
  const missing = SECTIONS.filter(({ key }) => !sections[key]).length;
  if (missing > 3) throw new Error('항목 누락');
  const questions = (Array.isArray(obj.questions) ? obj.questions : [])
    .slice(0, 2)
    .map((q) => (typeof q === 'string' ? { q, why: '' } : { q: String(q.q || ''), why: String(q.why || '') }))
    .filter((q) => q.q);
  return { sections, questions };
}

// ─── 최종 폴백: API 없이 규칙 기반 초안 ───
const T = {
  writing: {
    role: '독자 관점에 익숙한 전문 작가·에디터',
    process: '1. 핵심 메시지 1문장 정리\n2. 도입–본문–마무리 구조로 개요 작성\n3. 개요에 맞춰 초안 작성\n4. 문장 길이·어조 다듬기',
    output: '형식: [확인 필요: 블로그/메일/대본 등]\n분량: [확인 필요: 예) 800자 내외]\n톤: [확인 필요: 예) 친근한 존댓말]',
    verify: '- 요청 목적과 핵심 메시지가 일치하는지 확인\n- 사실 주장에는 근거가 있는지, 없으면 표시했는지 확인\n- 지정 분량·톤 준수 여부 확인',
    questions: [{ q: '누가 읽는 글인가요?', why: '어휘 수준과 톤이 달라집니다.' }, { q: '원하는 분량은?', why: '구성 깊이가 달라집니다.' }],
  },
  image: {
    role: '이미지 생성 AI용 프롬프트 아트디렉터',
    process: '1. 주제·피사체 정의\n2. 구도·시점·조명 지정\n3. 스타일·색감 지정\n4. 제외 요소(네거티브) 정리',
    output: '형식: 한 문단 영어 프롬프트 + 네거티브 프롬프트\n비율: [확인 필요: 예) 16:9]\n스타일: [확인 필요: 예) 사실적 사진/일러스트]',
    verify: '- 피사체·구도·스타일·비율이 모두 명시되었는지 확인\n- 서로 충돌하는 스타일 지시가 없는지 확인\n- 실존 인물·상표 사용 여부 확인',
    questions: [{ q: '어디에 쓰는 이미지인가요? (썸네일, SNS 등)', why: '비율과 구도가 달라집니다.' }, { q: '원하는 스타일은?', why: '결과 느낌이 크게 달라집니다.' }],
  },
  analysis: {
    role: '데이터를 근거로 판단하는 리서치 애널리스트',
    process: '1. 분석 질문 정의\n2. 입력 자료에서 핵심 수치·사실 추출\n3. 비교·그룹핑\n4. 시사점과 한계 정리',
    output: '형식: 마크다운 표 1개 + 핵심 요약 3줄\n분량: [확인 필요]\n각 주장 옆에 근거(자료 위치) 표기',
    verify: '- 모든 수치가 입력 자료에서 나왔는지 확인\n- 근거 없는 추정은 "추정"으로 표시했는지 확인\n- 결론이 분석 질문에 답하는지 확인',
    questions: [{ q: '분석할 자료가 있나요?', why: '자료 없이 분석하면 추정이 늘어납니다.' }, { q: '결과를 어디에 쓰나요? (보고, 의사결정 등)', why: '결론의 형태가 달라집니다.' }],
  },
  code: {
    role: '실무 경험이 많은 시니어 소프트웨어 엔지니어',
    process: '1. 요구사항·입출력 정리\n2. 설계 방법 간단히 설명\n3. 코드 작성(주석 포함)\n4. 실행 방법과 테스트 예시 제시',
    output: '형식: 설명 3줄 + 코드 블록 + 실행 방법\n언어/환경: [확인 필요: 예) Python 3.12]',
    verify: '- 예시 입력으로 실행했을 때 기대 출력이 나오는지 테스트\n- 예외·빈 입력 처리 확인\n- 사용 라이브러리 버전 명시 확인',
    questions: [{ q: '사용 언어·환경은?', why: '코드 문법과 라이브러리가 달라집니다.' }, { q: '입력과 기대 출력 예시가 있나요?', why: '정확한 동작 기준이 됩니다.' }],
  },
  other: {
    role: '[확인 필요: 해당 분야] 전문가',
    process: '1. 요청 목적 정리\n2. 필요한 정보 확인\n3. 단계별 수행\n4. 결과 정리',
    output: '형식: [확인 필요: 목록/표/문단]\n분량: [확인 필요]',
    verify: '- 요청 목적에 답했는지 확인\n- 근거 없는 내용은 표시했는지 확인\n- 지정 형식 준수 확인',
    questions: [{ q: '결과물을 어디에 쓰나요?', why: '형식과 깊이가 달라집니다.' }, { q: '원하는 결과 형식은?', why: '출력 구성이 달라집니다.' }],
  },
};

export function templateResult({ input, purpose, answers, locked }) {
  const t = T[purpose] || T.other;
  const ans = Object.entries(answers || {}).filter(([, v]) => v && v.trim());
  const ansText = ans.length ? '\n추가 조건:\n' + ans.map(([q, v]) => `- ${q} ${v}`).join('\n') : '';
  const sections = {
    role: `당신은 ${t.role}입니다.`,
    context: `요청: ${input}\n목적·대상: [확인 필요: 누가 어떤 상황에서 쓰는지]${ansText}`,
    input: `- 요청 내용: ${input}\n- 참고 자료: [확인 필요: 원문·데이터·예시가 있으면 붙여 넣기]`,
    process: t.process,
    output: t.output,
    verify: t.verify,
    security: '- 비밀번호·API 키·개인정보는 결과에 포함하지 않습니다.\n- 확인되지 않은 사실은 단정하지 않고 표시합니다.',
  };
  for (const [k, v] of Object.entries(locked || {})) if (v && v.trim()) sections[k] = v;
  return { sections, questions: ans.length ? [] : t.questions };
}
