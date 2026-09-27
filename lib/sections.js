// 스케치 순서: 역할 → 맥락 → 입력 → 처리 → 출력 → 검증 → 보안
export const SECTIONS = [
  { key: 'role', label: '역할', hint: 'AI가 맡을 전문가 역할' },
  { key: 'context', label: '맥락', hint: '배경, 대상 독자, 목적' },
  { key: 'input', label: '입력', hint: 'AI에게 주는 자료·조건' },
  { key: 'process', label: '처리', hint: '작업 단계와 규칙' },
  { key: 'output', label: '출력', hint: '형식, 분량, 톤' },
  { key: 'verify', label: '검증', hint: '결과를 점검할 기준' },
  { key: 'security', label: '보안', hint: '민감정보·금지사항' },
];

export const PURPOSES = [
  { key: 'writing', label: '글' },
  { key: 'image', label: '이미지' },
  { key: 'analysis', label: '분석' },
  { key: 'code', label: '코드' },
  { key: 'other', label: '기타' },
];

const PURPOSE_RULES = [
  ['image', /(이미지|그림|사진|썸네일|로고|일러스트|포스터|미드저니|midjourney|dall|배경화면|캐릭터 디자인)/i],
  ['code', /(코드|코딩|프로그램|함수|스크립트|api|버그|디버그|앱 만들|웹사이트|파이썬|python|javascript|sql|n8n|자동화)/i],
  ['analysis', /(분석|비교|요약|정리|데이터|통계|리서치|조사|엑셀|보고서|트렌드|검토)/i],
  ['writing', /(글|대본|원고|블로그|포스팅|이메일|메일|소개|카피|문구|기사|시|소설|스크립트 작성|자기소개|설명문|후기)/i],
];

export function guessPurpose(text = '') {
  for (const [key, re] of PURPOSE_RULES) if (re.test(text)) return key;
  return 'other';
}

export function assemblePrompt(sections) {
  return SECTIONS
    .map(({ key, label }) => `# ${label}\n${(sections?.[key] || '').trim()}`)
    .join('\n\n');
}
