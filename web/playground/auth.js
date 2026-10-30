// Optional "Sign in with ORCID" (OpenID Connect implicit flow, openid scope only).
// The ID token is verified in the browser against ORCID's published keys and only
// its ORCID iD and name are kept, for this browser tab. No access token is
// requested or stored, and nothing is sent to a server of ours.
const ISSUER = 'https://orcid.org';
const KEY = 'orcid-playground-signin';

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
  const params = new URLSearchParams({ client_id: clientId, response_type: 'id_token', scope: 'openid', redirect_uri: redirectUri(), state: pending.state, nonce: pending.nonce });
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
  if (!valid || claims.iss !== ISSUER || !audience.includes(clientId) || claims.nonce !== nonce || claims.exp * 1000 < Date.now()) {
    throw new Error('ORCID sign-in could not be verified.');
  }
  return claims;
}

// Completes a sign-in when ORCID redirects back with #id_token=…; returns the session or null.
export async function completeSignIn(clientId) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  if (!fragment.has('id_token') && !fragment.has('error')) return current();
  history.replaceState(null, '', location.pathname + location.search);
  const pending = read(`${KEY}-pending`);
  store(`${KEY}-pending`, null);
  if (fragment.has('error')) throw new Error(fragment.get('error_description') || 'ORCID sign-in was cancelled.');
  if (!pending || fragment.get('state') !== pending.state) throw new Error('ORCID sign-in response did not match this browser tab.');
  const claims = await verify(fragment.get('id_token'), clientId, pending.nonce);
  const session = { orcid: claims.sub, name: [claims.given_name, claims.family_name].filter(Boolean).join(' ') || null };
  store(KEY, session);
  return session;
}
