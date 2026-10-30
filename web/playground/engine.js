// Web Worker: runs the orcid_biosketch package under Pyodide, in the visitor's browser.
// Requests reach only the public ORCID API; the network workspace stays in this
// browser's IndexedDB and is never sent anywhere.
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const WORKSPACE = '/workspace';
const ORCID_HOSTS = new Set(['pub.orcid.org']);
const REQUEST_TIMEOUT_MS = 30000;

importScripts(`${PYODIDE}pyodide.js`);

// Synchronous XHR is permitted inside workers and lets the package's urllib code run as is.
function syncGet(url, headersJson) {
  const xhr = new XMLHttpRequest();
  try {
    if (!ORCID_HOSTS.has(new URL(url).hostname)) return JSON.stringify([0, '', null]);
    xhr.open('GET', url, false);
    xhr.timeout = REQUEST_TIMEOUT_MS;
    const headers = JSON.parse(headersJson);
    if (headers.Accept) xhr.setRequestHeader('Accept', headers.Accept);
    xhr.send();
  } catch {
    return JSON.stringify([0, '', null]);
  }
  return JSON.stringify([xhr.status, xhr.responseText, xhr.getResponseHeader('Retry-After')]);
}

const persist = (py, populate) => new Promise((resolve, reject) => py.FS.syncfs(populate, error => (error ? reject(error) : resolve())));

// Every open tab has its own copy of the workspace in memory. Under one lock
// shared by all tabs, reload the stored copy first and store it right after a
// change, so one tab never overwrites what another has saved.
async function withWorkspace(py, write, task) {
  const run = async () => {
    await persist(py, true);
    const result = task();
    if (write) {
      try {
        await persist(py, false);
      } catch {
        throw new Error('Could not save to this browser’s storage; the change was not kept.');
      }
    }
    return result;
  };
  return self.navigator.locks ? self.navigator.locks.request('orcid-playground-workspace', run) : run();
}

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
`);
  return { py, engine: py.globals.get('playground'), workspace: null };
})();

const operations = {
  async profile({ engine }, { orcid }) {
    return engine.profile(orcid);
  },
  async sample({ engine }, { biosketch }) {
    return engine.profile_from_biosketch(biosketch);
  },
  async fortune({ engine }, { biosketch, seed }) {
    return engine.fortune(biosketch, seed);
  },
  async api(state, { method, target, body }) {
    const file = `${WORKSPACE}/network.sqlite3`;
    return withWorkspace(state.py, method !== 'GET', () => {
      // Another tab may have cleared the workspace since this one last opened it.
      if (!state.py.FS.analyzePath(file).exists) state.workspace = null;
      state.workspace ??= state.engine.Workspace(file);
      return state.workspace.request(method, target, body ?? null);
    });
  },
  async reset(state) {
    return withWorkspace(state.py, true, () => {
      state.workspace?.destroy();
      state.workspace = null;
      for (const name of state.py.FS.readdir(WORKSPACE)) {
        if (name !== '.' && name !== '..') state.py.FS.unlink(`${WORKSPACE}/${name}`);
      }
      return 'ok';
    });
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
