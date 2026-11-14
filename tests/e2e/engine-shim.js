// Test double for /engine-client.js, used only by tests/e2e/onboarding.e2e.cjs.
// Same call(op, args) contract as the real module, but the operations are answered by
// tests/e2e/onboarding_server.py (CPython running the same package) instead of Pyodide in a
// worker. Captures the browser's own fetch before network-bridge.js wraps it.
const nativeFetch = window.fetch.bind(window);

export async function call(op, args = {}) {
  const response = await nativeFetch('/__engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, args }) });
  const reply = await response.json();
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}
