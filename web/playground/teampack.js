// Password-protected team packages, encrypted and decrypted in this browser with WebCrypto.
// PBKDF2-SHA256 (random 16-byte salt) derives an AES-GCM-256 key; each file has a random
// 12-byte IV. The format, version and key-derivation settings are authenticated as
// additional data, so changing any of them makes decryption fail. Nothing is sent anywhere:
// anyone holding both the file and the password can read it.
export const FORMAT = 'orcid-playground-team-pack';
export const VERSION = 1;
export const ITERATIONS = 310000;
// A file asking for far more work than this is refused rather than freezing the tab.
const MAX_ITERATIONS = 5000000;
export const MIN_PASSWORD = 12;

const encoder = new TextEncoder();

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text, field) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error(`The team package ${field} is damaged.`);
  try { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); } catch { throw new Error(`The team package ${field} is damaged.`); }
}

const additionalData = kdf => encoder.encode(`${FORMAT}/${VERSION}/${kdf.name}/${kdf.hash}/${kdf.iterations}/${kdf.salt}`);

async function deriveKey(password, salt, iterations, subtle) {
  const base = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptPack(plaintext, password, { iterations = ITERATIONS, crypto = globalThis.crypto } = {}) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) throw new Error(`Choose a password of at least ${MIN_PASSWORD} characters.`);
  if (!Number.isInteger(iterations) || iterations < ITERATIONS || iterations > MAX_ITERATIONS) throw new Error('Unsupported key-derivation strength.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) };
  const key = await deriveKey(password, salt, iterations, crypto.subtle);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additionalData(kdf), tagLength: 128 }, key, encoder.encode(plaintext));
  return { format: FORMAT, version: VERSION, kdf, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

// Checks the envelope only; says nothing about the contents until decrypted.
export function readEnvelope(document) {
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(document) || document.format !== FORMAT) throw new Error('This is not an ORCID Playground team package.');
  if (document.version !== VERSION) throw new Error(`Unsupported team package version ${JSON.stringify(document.version)}; this site reads version ${VERSION}.`);
  const keys = Object.keys(document).sort().join(',');
  if (keys !== 'ciphertext,format,iv,kdf,version') throw new Error('The team package has unexpected fields.');
  const { kdf } = document;
  if (!isObject(kdf) || Object.keys(kdf).sort().join(',') !== 'hash,iterations,name,salt' || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256'
      || !Number.isInteger(kdf.iterations) || kdf.iterations < ITERATIONS || kdf.iterations > MAX_ITERATIONS) {
    throw new Error('The team package uses unsupported key-derivation settings.');
  }
  const salt = fromBase64(kdf.salt, 'salt');
  const iv = fromBase64(document.iv, 'IV');
  const ciphertext = fromBase64(document.ciphertext, 'contents');
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('The team package is damaged.');
  return { kdf, salt, iv, ciphertext };
}

export async function decryptPack(document, password, { crypto = globalThis.crypto } = {}) {
  const { kdf, salt, iv, ciphertext } = readEnvelope(document);
  const key = await deriveKey(String(password ?? ''), salt, kdf.iterations, crypto.subtle);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: additionalData(kdf), tagLength: 128 }, key, ciphertext);
  } catch {
    throw new Error('Wrong password, or the file was changed after it was made.');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(plain);
}
