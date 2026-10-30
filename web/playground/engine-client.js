// Page-side handle on the in-browser engine worker (engine.js).
// Every playground page imports this module, so it also installs the offline service worker.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
let worker;
let next = 0;
const pending = new Map();
// Generous: a bulk import of a large record can take a while on a slow connection.
const TIMEOUT_MS = 180000;

function start() {
  worker = new Worker('/engine.js');
  worker.onmessage = ({ data: { id, ok, result, error } }) => {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);
    if (ok) request.resolve(result);
    else request.reject(new Error(String(error).replace(/^[\w.]*(Error|Exception):\s*/, '')));
  };
  worker.onerror = event => {
    // Typically the Python runtime could not be downloaded. Start afresh on the next call.
    console.error('Engine worker failed:', event.message);
    worker.terminate();
    worker = undefined;
    for (const request of pending.values()) request.reject(new Error('The engine could not start. Check your connection and try again.'));
    pending.clear();
  };
}

export function call(op, args = {}) {
  if (!worker) start();
  const id = ++next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error('The engine took too long to answer. Reload the page and try again.'));
    }, TIMEOUT_MS);
    const done = fn => value => { clearTimeout(timer); fn(value); };
    pending.set(id, { resolve: done(resolve), reject: done(reject) });
    worker.postMessage({ id, op, args });
  });
}
