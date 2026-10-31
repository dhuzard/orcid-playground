// Optional "Sign in with ORCID" (OpenID Connect implicit flow, openid scope only).
// The ID token is verified in the browser against ORCID's published keys and only
// its ORCID iD and name are kept, for this browser tab. ORCID documents the implicit
// flow only for response_type 'token' or 'id_token token' (ORCID-Source
// orcid-web/ORCID_AUTH_WITH_OPENID_CONNECT.md), so 'id_token token' is requested:
// the short-lived, openid-scoped access token that comes with it is never read,
// stored or used, and is wiped from the address bar with the rest of the fragment.
// Nothing is sent to a server of ours.
const ISSUER = 'https://orcid.org';
const KEY = 'orcid-playground-signin';
// ORCID ID tokens live 10 minutes; tolerate a visitor's clock running a little fast.
const CLOCK_SKEW_SECONDS = 300;

const b64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const redirectUri = () => `${location.origin}/`;

function store(name, value) {
  try { value === null ? sessionStorage.removeItem(name) : sessionStorage.setItem(name, JSON.stringify(value)); } catch { /* Private mode: sign-in lasts for this page only. */ }
}
function read(name) {
  try { return JSON.parse(sessionStorage.getItem(name)); } catch { return null; }
}

export async function config() {
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    return response.ok ? await response.json() : {};
  } catch { return {}; }
}

export function signIn(clientId) {
  const pending = { state: random(), nonce: random() };
  store(`${KEY}-pending`, pending);
  const params = new URLSearchParams({ client_id: clientId, response_type: 'id_token token', scope: 'openid', redirect_uri: redirectUri(), state: pending.state, nonce: pending.nonce });
  location.assign(`${ISSUER}/oauth/authorize?${params}`);
}

export function signOut() {
  store(KEY, null);
}

export function current() {
  return read(KEY);
}

async function verify(token, clientId, nonce) {
  const [header64, payload64, signature64] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(b64url(header64)));
  const claims = JSON.parse(new TextDecoder().decode(b64url(payload64)));
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm.');
  const { keys } = await (await fetch(`${ISSUER}/oauth/jwks`)).json();
  const jwk = keys.find(k => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error('ORCID signing key not found.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(signature64), new TextEncoder().encode(`${header64}.${payload64}`));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!valid || claims.iss !== ISSUER || !audience.includes(clientId) || claims.nonce !== nonce || typeof claims.exp !== 'number' || (claims.exp + CLOCK_SKEW_SECONDS) * 1000 < Date.now()) {
    throw new Error('ORCID sign-in could not be verified.');
  }
  return claims;
}

// ORCID may report a refused sign-in in the query string rather than the fragment
// (its docs say so for prompt=none errors). Only honoured while a sign-in started
// in this tab is pending; the error parameters are removed from the address bar.
function queryError() {
  const query = new URLSearchParams(location.search);
  if (!query.has('error') || !read(`${KEY}-pending`)) return false;
  for (const name of ['error', 'error_description', 'state']) query.delete(name);
  const rest = query.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  store(`${KEY}-pending`, null);
  return true;
}

// Completes a sign-in when ORCID redirects back with #id_token=…; returns the session or null.
export async function completeSignIn(clientId) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('id_token') && !fragment.has('error')) {
    if (queryError()) throw new Error('ORCID sign-in was cancelled or refused.');
    return current();
  }
  history.replaceState(null, '', location.pathname + location.search);
  const pending = read(`${KEY}-pending`);
  store(`${KEY}-pending`, null);
  if (!pending || fragment.get('state') !== pending.state) throw new Error('ORCID sign-in response did not match this browser tab.');
  if (fragment.has('error')) throw new Error('ORCID sign-in was cancelled or refused.');
  const claims = await verify(fragment.get('id_token'), clientId, pending.nonce);
  const session = { orcid: claims.sub, name: [claims.given_name, claims.family_name].filter(Boolean).join(' ') || null };
  store(KEY, session);
  return session;
}
