// 품질 점검: 목적·입력·출력 형식·검증 기준의 누락/모순 표시 + 수정 제안
const NEED = /\[확인 필요[^\]]*\]/g;

export function checkQuality(s = {}) {
  const issues = [];
  const t = (k) => (s[k] || '').trim();
  const onlyNeed = (k) => t(k).replace(NEED, '').replace(/[\s\-•·:.]/g, '').length < 6;

  if (!t('role') || onlyNeed('role'))
    issues.push({ level: 'warn', section: 'role', msg: '역할이 비어 있습니다.', fix: '예: "10년 차 마케팅 카피라이터"처럼 전문 분야와 수준을 적어 주세요.' });
  if (!t('context') || onlyNeed('context'))
    issues.push({ level: 'warn', section: 'context', msg: '목적·대상이 불분명합니다.', fix: '누가, 왜 이 결과물을 쓰는지 한 문장 추가하세요.' });
  if (!t('input') || onlyNeed('input'))
    issues.push({ level: 'warn', section: 'input', msg: 'AI에게 줄 자료가 비어 있습니다.', fix: '원문, 수치, 키워드 등 실제 자료를 붙여 넣으세요.' });
  if (!/(형식|표|목록|리스트|json|마크다운|markdown|문단|단락|분량|자\b|자 |글자|단어|줄|개|장|초|분|해상도|비율|코드 블록|톤|어조)/i.test(t('output')))
    issues.push({ level: 'warn', section: 'output', msg: '출력 형식·분량 지정이 없습니다.', fix: '예: "마크다운 표 1개 + 요약 3줄", "800자 내외"처럼 정해 주세요.' });
  if (!/(확인|점검|검토|기준|체크|테스트|검증|맞는지|여부|근거|출처)/.test(t('verify')))
    issues.push({ level: 'warn', section: 'verify', msg: '검증 기준이 없습니다.', fix: '결과를 받았을 때 확인할 항목 2~3개를 적으세요.' });

  const all = Object.values(s).join('\n');
  const out = t('output');
  if (/(짧게|간단히|간결)/.test(out) && /(상세히|자세히|길게|구체적으로 모두)/.test(out))
    issues.push({ level: 'error', section: 'output', msg: '"짧게"와 "자세히"가 함께 있어 모순됩니다.', fix: '분량을 숫자로 하나만 지정하세요.' });
  const lens = [...out.matchAll(/(\d{2,5})\s*자/g)].map((m) => m[1]);
  if (new Set(lens).size > 1)
    issues.push({ level: 'error', section: 'output', msg: `분량이 여러 개(${[...new Set(lens)].join('자, ')}자)로 지정되었습니다.`, fix: '하나의 분량으로 통일하세요.' });
  if (/json만|json 형식만/i.test(out) && /(표|마크다운)/.test(out))
    issues.push({ level: 'error', section: 'output', msg: 'JSON만 요구하면서 표/마크다운도 요구합니다.', fix: '출력 형식을 하나로 정하세요.' });
  if (/(100%\s*정확|정확성을?\s*보장|완벽하게 정확|틀림없이)/.test(all))
    issues.push({ level: 'warn', section: 'verify', msg: '정확성 보장 표현이 있습니다.', fix: 'AI 결과는 보장할 수 없으니 "근거와 함께 제시" 등으로 바꾸세요.' });

  const needCount = (all.match(NEED) || []).length;
  if (needCount)
    issues.push({ level: 'info', section: null, msg: `확인 필요 항목 ${needCount}개가 있습니다.`, fix: '노란 표시 부분을 직접 채우면 품질이 올라갑니다.' });

  return issues;
}
