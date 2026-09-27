# 한줄설계 · 프롬프트 1앱 (모바일 웹앱)

한 줄 입력 → 용도 자동 추천 → **역할·맥락·입력·처리·출력·검증·보안** 7항목 프롬프트 생성 → 항목별 수정·고정 → 복사·공유·저장.

## 구성
| 영역 | 파일 | 내용 |
|---|---|---|
| 화면 | `app/page.js` | 만들기 / 내역 / 엔진 설정 (하단 탭) |
| 생성 API | `app/api/generate/route.js` | 입력 검증, 서버측 마스킹, 고정 항목 보존, 요청 제한 |
| AI 라우터 | `lib/router.js` | 다중 공급사 × 다중 키, 로테이션, 쿨다운, 자동 폴백 |
| 폴백 | `lib/prompt.js` | 모든 AI 실패 시 규칙 기반 초안 |
| 품질 점검 | `lib/quality.js` | 목적·입력·출력 형식·검증 누락, 분량 모순 등 |
| 보안 | `lib/security.js` | API 키·비밀번호·주민번호·카드·전화·이메일 감지/마스킹 |

## AI 다중화 동작
1. 사용자가 고른 엔진(또는 자동) → 실패 시 `PROVIDER_ORDER` 순서로 다음 엔진
2. 공급사별 키 여러 개(쉼표) 로테이션, 401/403/429/5xx/시간초과 키는 쿨다운
3. 전부 실패 → 규칙 기반 초안(앱은 항상 동작)
4. 사용자 개인 키(BYOK)는 브라우저에만 저장, 서버에 저장·기록하지 않음

## 배포 (Vercel)
1. Vercel → Add New → Project → 이 저장소 Import (Next.js 자동 인식)
2. Settings → Environment Variables 에 `.env.example` 참고해 키 입력
3. Deploy. 키 변경 후에는 Redeploy 필요

## 로컬 실행
```
npm install
cp .env.example .env.local
npm run dev
```
