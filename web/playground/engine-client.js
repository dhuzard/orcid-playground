// Page-side handle on the in-browser engine worker (engine.js).
let worker;
let next = 0;
const pending = new Map();

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
    for (const request of pending.values()) request.reject(new Error(event.message || 'The engine stopped.'));
    pending.clear();
  };
}

export function call(op, args = {}) {
  if (!worker) start();
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, op, args });
  });
}
