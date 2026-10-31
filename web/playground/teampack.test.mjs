// Offline tests for password-protected team packages (teampack.js), using Node's WebCrypto.
import assert from 'node:assert/strict';
import test from 'node:test';
import { decryptPack, encryptPack, readEnvelope, FORMAT, ITERATIONS } from './teampack.js';

const PASSWORD = 'correct horse battery staple';
const PLAINTEXT = JSON.stringify({ format: 'orcid-playground-team-group', group: { name: 'Lab · Ünïcode' }, big: 'x'.repeat(100000) });

test('round trip: the right password returns the exact contents', async () => {
  const pack = await encryptPack(PLAINTEXT, PASSWORD);
  assert.equal(pack.format, FORMAT);
  assert.equal(pack.version, 1);
  assert.deepEqual(Object.keys(pack).sort(), ['ciphertext', 'format', 'iv', 'kdf', 'version']);
  assert.deepEqual({ ...pack.kdf, salt: undefined }, { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: undefined });
  assert.ok(ITERATIONS >= 310000);
  const { salt, iv } = readEnvelope(pack);
  assert.equal(salt.length, 16);
  assert.equal(iv.length, 12);
  assert.ok(!JSON.stringify(pack).includes('team-group'), 'contents are not readable in the file');
  // Survives being written to and read from a file.
  assert.equal(await decryptPack(JSON.parse(JSON.stringify(pack)), PASSWORD), PLAINTEXT);
});

test('each package gets a fresh salt and IV', async () => {
  const [a, b] = await Promise.all([encryptPack('same', PASSWORD), encryptPack('same', PASSWORD)]);
  assert.notEqual(a.kdf.salt, b.kdf.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('a wrong password fails', async () => {
  const pack = await encryptPack(PLAINTEXT, PASSWORD);
  await assert.rejects(decryptPack(pack, 'correct horse battery stapler'), /Wrong password/);
  await assert.rejects(decryptPack(pack, ''), /Wrong password/);
});

test('tampered ciphertext, IV or settings fail', async () => {
  const pack = await encryptPack(PLAINTEXT, PASSWORD);
  const bytes = Buffer.from(pack.ciphertext, 'base64');
  bytes[10] ^= 1;
  await assert.rejects(decryptPack({ ...pack, ciphertext: bytes.toString('base64') }, PASSWORD), /Wrong password, or the file was changed/);
  const iv = Buffer.from(pack.iv, 'base64');
  iv[0] ^= 1;
  await assert.rejects(decryptPack({ ...pack, iv: iv.toString('base64') }, PASSWORD), /changed/);
  // Raising the iteration count is authenticated too (and changes the key).
  await assert.rejects(decryptPack({ ...pack, kdf: { ...pack.kdf, iterations: ITERATIONS + 1 } }, PASSWORD), /changed/);
  await assert.rejects(decryptPack({ ...pack, ciphertext: pack.ciphertext.slice(0, -8) }, PASSWORD), /damaged|changed/);
});

test('malformed or unsupported envelopes are refused before any decryption', async () => {
  const pack = await encryptPack('x', PASSWORD);
  const cases = [
    [null, /not an ORCID Playground team package/],
    [{ ...pack, format: 'orcid-playground-workspace' }, /not an ORCID Playground team package/],
    [{ ...pack, version: 2 }, /Unsupported team package version 2/],
    [{ ...pack, extra: 1 }, /unexpected fields/],
    [{ ...pack, kdf: { ...pack.kdf, iterations: 1000 } }, /key-derivation/],
    [{ ...pack, kdf: { ...pack.kdf, hash: 'SHA-1' } }, /key-derivation/],
    [{ ...pack, iv: 'not base64!' }, /damaged/],
    [{ ...pack, iv: Buffer.alloc(8).toString('base64') }, /damaged/],
  ];
  for (const [document, message] of cases) await assert.rejects(decryptPack(document, PASSWORD), message);
});

test('short passwords and weak settings are refused when encrypting', async () => {
  await assert.rejects(encryptPack('x', 'short'), /at least 12/);
  await assert.rejects(encryptPack('x', PASSWORD, { iterations: 1000 }), /strength/);
});
