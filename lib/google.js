// Google 로그인(OAuth 2.0 + OpenID Connect, Authorization Code + PKCE)
// - 관리자 이메일 → 관리자 세션 / 허용 이메일 → 앱 사용 세션(30일) / 그 외 → 거부
// - 클라이언트 보안 비밀은 AES-256-GCM 암호화 저장, 화면에는 끝 4자리만
import crypto from 'node:crypto';
import { kvGet, kvSet, kvDel } from './store.js';
import { encrypt, decrypt, randomToken, sha256 } from './crypto.js';

const PROD = process.env.NODE_ENV === 'production';
const TEST = process.env.HJ_ALLOW_MEMORY_STORE === '1' || !PROD;
// 엔드포인트: Google 공개 설정(.well-known/openid-configuration) 기준. 테스트 환경에서만 교체 가능
const AUTH_URL = (TEST && process.env.GOOGLE_AUTH_URL) || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = (TEST && process.env.GOOGLE_TOKEN_URL) || 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const CFG = 'hj:google';
export const STATE_COOKIE = PROD ? '__Host-hj_oauth' : 'hj_oauth';
export const GACC_COOKIE = PROD ? '__Host-hj_gacc' : 'hj_gacc';
export const GACC_TTL = 30 * 24 * 3600;

const norm = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function loadGoogle() {
  return { clientId: '', secretEnc: '', secretHint: '', adminEmails: [], userEmails: [], ...JSON.parse((await kvGet(CFG)) || '{}') };
}

export function maskGoogle(g) {
  return { clientId: g.clientId, secretHint: g.secretHint, adminEmails: g.adminEmails, userEmails: g.userEmails, enabled: isEnabled(g) };
}

export const isEnabled = (g) => Boolean(g.clientId && g.secretEnc && g.adminEmails.length);

function emails(list) {
  const out = [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,;]+/)).map(norm).filter(Boolean))];
  const bad = out.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new Error(`이메일 형식이 아닙니다: ${bad}`);
  if (out.length > 100) throw new Error('최대 100개까지 등록할 수 있습니다.');
  return out;
}

// 관리자 설정 변경
export async function updateGoogle(a) {
  const g = await loadGoogle();
  if (a.clientId !== undefined) {
    const id = String(a.clientId).trim();
    if (id && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new Error('클라이언트 ID 형식이 올바르지 않습니다(…apps.googleusercontent.com).');
    g.clientId = id;
  }
  if (a.clientSecret) {
    const s = String(a.clientSecret).trim();
    if (s.length < 10 || /\s/.test(s)) throw new Error('클라이언트 보안 비밀이 올바르지 않습니다.');
    g.secretEnc = encrypt(s); g.secretHint = '…' + s.slice(-4);
  }
  if (a.clearSecret) { g.secretEnc = ''; g.secretHint = ''; }
  if (a.adminEmails !== undefined) g.adminEmails = emails(a.adminEmails);
  if (a.userEmails !== undefined) g.userEmails = emails(a.userEmails);
  await kvSet(CFG, JSON.stringify(g));
  return g;
}

export function originOf(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || (PROD ? 'https' : 'http');
  return `${proto}://${host}`;
}
export const redirectUri = (req) => `${originOf(req)}/api/auth/google/callback`;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

// 1단계: Google 로그인 화면으로 보낼 주소 생성
export async function startLogin(req, purpose) {
  const g = await loadGoogle();
  if (!isEnabled(g)) throw new Error('Google 로그인이 아직 설정되지 않았습니다.');
  const state = randomToken(24);
  const verifier = randomToken(48);
  const nonce = randomToken(16);
  await kvSet(`hj:oauth:${sha256(state)}`, JSON.stringify({ verifier, nonce, purpose: purpose === 'admin' ? 'admin' : 'app', at: Date.now() }), 600);
  const q = new URLSearchParams({
    client_id: g.clientId,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { url: `${AUTH_URL}?${q}`, state };
}

// 2단계: 콜백 처리 → { email, role: 'admin'|'user' }
export async function finishLogin(req, { code, state, cookieState }) {
  if (!code || !state || !cookieState || state.length > 100) throw new Error('state');
  if (!crypto.timingSafeEqual(Buffer.from(sha256(state)), Buffer.from(sha256(cookieState)))) throw new Error('state');
  const key = `hj:oauth:${sha256(state)}`;
  const st = JSON.parse((await kvGet(key)) || 'null');
  await kvDel(key); // 1회용
  if (!st) throw new Error('expired');

  const g = await loadGoogle();
  if (!isEnabled(g)) throw new Error('disabled');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: g.clientId, client_secret: decrypt(g.secretEnc),
      redirect_uri: redirectUri(req), grant_type: 'authorization_code', code_verifier: st.verifier,
    }),
    cache: 'no-store',
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) throw new Error('token');

  // ID 토큰은 Google 토큰 엔드포인트에서 TLS로 직접 받은 것이므로 서명 대신 발급자 확인으로 갈음(OIDC Core 3.1.3.7)
  const parts = String(tok.id_token).split('.');
  if (parts.length !== 3) throw new Error('idtoken');
  const c = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (!ISSUERS.includes(c.iss)) throw new Error('iss');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(g.clientId)) throw new Error('aud');
  if (!c.exp || c.exp < now - 60) throw new Error('exp');
  if (c.nonce !== st.nonce) throw new Error('nonce');
  if (c.email_verified !== true && c.email_verified !== 'true') throw new Error('unverified');

  const email = norm(c.email);
  const role = g.adminEmails.includes(email) ? 'admin' : g.userEmails.includes(email) ? 'user' : null;
  return { email, role, purpose: st.purpose };
}

// Google 사용자 세션
export async function startGoogleAccess(res, email) {
  const t = randomToken(32);
  await kvSet(`hj:gacc:${sha256(t)}`, JSON.stringify({ email, at: Date.now() }), GACC_TTL);
  res.cookies.set(GACC_COOKIE, t, { httpOnly: true, secure: PROD, sameSite: 'strict', path: '/', maxAge: GACC_TTL });
}

// 세션이 유효하고, 해당 이메일이 아직 허용 목록에 있는지(목록에서 빼면 즉시 차단)
export async function googleAccessOf(req) {
  const t = req.cookies.get(GACC_COOKIE)?.value;
  if (!t || t.length < 20 || t.length > 100) return null;
  const s = JSON.parse((await kvGet(`hj:gacc:${sha256(t)}`)) || 'null');
  if (!s) return null;
  const g = await loadGoogle();
  return g.adminEmails.includes(s.email) || g.userEmails.includes(s.email) ? s.email : null;
}

export async function endGoogleAccess(req, res) {
  const t = req.cookies.get(GACC_COOKIE)?.value;
  if (t) await kvDel(`hj:gacc:${sha256(t)}`).catch(() => {});
  res.cookies.set(GACC_COOKIE, '', { httpOnly: true, secure: PROD, sameSite: 'strict', path: '/', maxAge: 0 });
}
