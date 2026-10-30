// Web Worker: runs the orcid_biosketch package under Pyodide, in the visitor's browser.
// Requests reach only the public ORCID API; the network workspace stays in this
// browser's IndexedDB and is never sent anywhere.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const WORKSPACE = '/workspace';
const ORCID_HOSTS = new Set(['pub.orcid.org', 'pub.sandbox.orcid.org']);

importScripts(`${PYODIDE}pyodide.js`);

// Synchronous XHR is permitted inside workers and lets the package's urllib code run as is.
function syncGet(url, headersJson) {
  if (!ORCID_HOSTS.has(new URL(url).hostname)) return JSON.stringify([0, '', null]);
  const xhr = new XMLHttpRequest();
  try {
    xhr.open('GET', url, false);
    const headers = JSON.parse(headersJson);
    if (headers.Accept) xhr.setRequestHeader('Accept', headers.Accept);
    xhr.send();
  } catch {
    return JSON.stringify([0, '', null]);
  }
  return JSON.stringify([xhr.status, xhr.responseText, xhr.getResponseHeader('Retry-After')]);
}

const persist = (py, populate) => new Promise((resolve, reject) => py.FS.syncfs(populate, error => (error ? reject(error) : resolve())));

const ready = (async () => {
  const py = await loadPyodide({ indexURL: PYODIDE });
  await py.loadPackage('sqlite3');
  const archive = await fetch('/py/orcid_biosketch.zip');
  if (!archive.ok) throw new Error(`Could not load the engine (HTTP ${archive.status}).`);
  py.unpackArchive(await archive.arrayBuffer(), 'zip', { extractDir: '/lib/playground' });
  py.FS.mkdirTree(WORKSPACE);
  py.FS.mount(py.FS.filesystems.IDBFS, {}, WORKSPACE);
  await persist(py, true);
  py.globals.set('sync_get', syncGet);
  py.runPython(`
import sys
sys.path.insert(0, "/lib/playground")
from orcid_biosketch import playground
playground.install_transport(sync_get)
workspace = None
`);
  return py;
})();

const operations = {
  async profile(py, { orcid }) {
    return py.globals.get('playground').profile(orcid);
  },
  async sample(py, { biosketch }) {
    return py.globals.get('playground').profile_from_biosketch(biosketch);
  },
  async fortune(py, { biosketch, seed }) {
    return py.globals.get('playground').fortune(biosketch, seed);
  },
  async api(py, { method, target, body }) {
    if (!py.globals.get('workspace')) py.runPython(`workspace = playground.Workspace("${WORKSPACE}/network.sqlite3")`);
    const reply = py.globals.get('workspace').request(method, target, body ?? null);
    if (method !== 'GET') await persist(py, false);
    return reply;
  },
  async reset(py) {
    py.runPython(`
import os
workspace = None
for name in os.listdir("${WORKSPACE}"):
    os.remove(os.path.join("${WORKSPACE}", name))
`);
    await persist(py, false);
    return 'ok';
  },
};

// One request at a time: the workspace is a single SQLite file.
let queue = Promise.resolve();
self.onmessage = ({ data: { id, op, args } }) => {
  queue = queue.then(async () => {
    try {
      const py = await ready;
      if (!Object.hasOwn(operations, op)) throw new Error(`Unknown operation ${op}`);
      self.postMessage({ id, ok: true, result: await operations[op](py, args || {}) });
    } catch (error) {
      const message = String(error?.message || error).split('\n').filter(Boolean);
      // Python tracebacks end with the exception line, which is the useful part.
      self.postMessage({ id, ok: false, error: message[message.length - 1] || 'Engine error' });
    }
  });
};
