// Shareable group links. The group lives entirely in the URL fragment, which
// browsers never send to a server: a name and public ORCID iDs, nothing else.
export const MAX_MEMBERS = 50;
export const MAX_NAME = 120;
const PREFIX = '#v1.';

export function validOrcid(id) {
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(id)) return false;
  const digits = id.replaceAll('-', '');
  let total = 0;
  for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - total % 11) % 11;
  return digits[15] === (check === 10 ? 'X' : String(check));
}

export function parseIds(text) {
  const ids = [];
  const invalid = [];
  for (const token of String(text).split(/[\s,;]+/).filter(Boolean)) {
    const id = token.replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '').replace(/\/$/, '').toUpperCase();
    if (!validOrcid(id)) invalid.push(token);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, invalid };
}

const toBase64Url = text => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = text => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));

export function encodeGroup({ name, members }) {
  return PREFIX + toBase64Url(JSON.stringify({ n: String(name).trim().slice(0, MAX_NAME), m: members.slice(0, MAX_MEMBERS) }));
}

// Returns { name, members } or throws with a reason a visitor can act on.
export function decodeGroup(hash) {
  if (!hash.startsWith(PREFIX)) throw new Error('This is not a group link.');
  let data;
  try { data = JSON.parse(fromBase64Url(hash.slice(PREFIX.length))); } catch { throw new Error('This group link is damaged. Ask for it again.'); }
  const name = typeof data?.n === 'string' ? data.n.trim().slice(0, MAX_NAME) : '';
  const members = Array.isArray(data?.m) ? [...new Set(data.m.filter(id => typeof id === 'string' && validOrcid(id)))] : [];
  if (!members.length) throw new Error('This group link has no valid ORCID iDs.');
  if (members.length > MAX_MEMBERS) throw new Error(`Group links hold at most ${MAX_MEMBERS} members.`);
  return { name: name || 'Shared group', members };
}
