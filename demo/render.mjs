// Renders the ORCID Playground demo from the web app's UI only: one full cut plus square LinkedIn clips.
// The real site is built (scripts/build_site.py) and served locally; the Studio runs on the maintainer's
// stored profile and the network on its labelled Demo sample data. Nothing is mocked or invented.
//   node demo/render.mjs [site-dir]   (site-dir defaults to ./site; needs playwright and ffmpeg)
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'demo/out');
const RAW = resolve(OUT, '.raw');
const SITE = 'orcid-playground-889.web.app';
const W = 1280, H = 720, PORT = 8899;
const SITE_DIR = resolve(process.argv[2] || resolve(ROOT, 'site'));
mkdirSync(RAW, { recursive: true });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
:root{--ink:#143d37;--lime:#d6ea7a;--cream:#f6f5ef;--mute:#9db8b0}
*{box-sizing:border-box;margin:0}body{width:${W}px;height:${H}px;background:var(--ink);color:var(--cream);font:16px Inter,system-ui,sans-serif;overflow:hidden}
.mark{position:absolute;left:36px;top:28px;display:flex;gap:12px;align-items:center;font-weight:600;letter-spacing:.02em}
.mark b{background:var(--lime);color:var(--ink);width:36px;height:36px;border-radius:9px;display:grid;place-items:center;font:700 22px Georgia,serif}
.site{position:absolute;right:36px;top:36px;color:var(--mute);font-size:14px;letter-spacing:.06em}
`;
const CAPCSS = `
#cap{position:fixed;left:36px;right:36px;bottom:26px;padding:18px 28px 20px;background:#143d37!important;border:1px solid #2c5a51;border-radius:16px;box-shadow:0 12px 40px #0006;z-index:99999;opacity:0;transition:opacity .5s}
#cap.on{opacity:1}#cap *{margin:0!important;font-family:Inter,system-ui,sans-serif!important;color:#f6f5ef!important;background:none!important}
#cap i{font-style:normal;color:#d6ea7a!important;font-size:13px;letter-spacing:.14em;display:block;margin-bottom:6px!important}
#cap h2{font:400 34px Georgia,serif!important;margin-bottom:6px!important}#cap p{font-size:19px;color:#d6e3dd!important;line-height:1.35}`;

async function caption(page, kicker, title, text) {
  await page.evaluate(([k, t, x, css]) => {
    if (!document.getElementById('capcss')) { const s = document.createElement('style'); s.id = 'capcss'; s.textContent = css; document.head.append(s); }
    let c = document.getElementById('cap'); if (!c) { c = document.createElement('div'); c.id = 'cap'; document.body.append(c); }
    c.classList.remove('on');
    setTimeout(() => { c.innerHTML = `<i>${k}</i><h2>${t}</h2><p>${x}</p>`; c.classList.add('on'); }, 350);
  }, [kicker, title, text, CAPCSS]);
}

// Record one take to mp4. `body(page, at)` runs the take; at() returns seconds since the video began.
async function record(browser, id, body) {
  const dir = resolve(RAW, id); rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, bypassCSP: true, recordVideo: { dir, size: { width: W, height: H } } });
  const t0 = Date.now();
  const page = await ctx.newPage();
  await body(page, () => (Date.now() - t0) / 1000);
  await ctx.close();
  const webm = readdirSync(dir).find(f => f.endsWith('.webm'));
  const mp4 = resolve(RAW, `${id}.mp4`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', resolve(dir, webm), '-r', '30', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-an', mp4]);
  console.log('take', id);
  return mp4;
}
// Cut [from, to] seconds out of a take.
function cut(src, from, to, dst) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(from), '-to', String(to), '-i', src, '-r', '30', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-an', dst]);
  return dst;
}

const card = (inner) => `<style>${CSS}.c{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:60px}
h1{font:400 76px/1.05 Georgia,serif;max-width:1000px}h1 em{color:var(--lime);font-style:normal}p{margin-top:24px;font-size:24px;color:#cfe0d9;max-width:880px;line-height:1.4;margin-inline:auto}
.pill{display:inline-block;margin:26px 6px 0;padding:8px 16px;border:1px solid #3f776b;border-radius:99px;font-size:17px;color:var(--lime)}</style>
<div class="mark"><b>o.</b>ORCID Playground</div><div class="site">${SITE}</div><div class="c">${inner}</div>`;

const toTabs = (p) => p.evaluate(() => document.querySelector('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' }));
const tab = async (p, name) => { await p.click(`[data-tab="${name}"]`); await toTabs(p); await p.waitForTimeout(600); };

// Studio: one take; `seg` marks where each topic begins. The engine is warmed up before time zero.
async function studio(b, url) {
  const segs = [];
  const mp4 = await record(b, 'studio', async (p, at) => {
    const seg = (id) => segs.push({ id, t: at() });
    await p.goto(url); await p.waitForTimeout(14000);          // engine warm-up, trimmed away below
    const t0 = at(); seg('landing');
    await caption(p, 'THE STUDIO', 'Play with any public ORCID record.', 'Enter an iD and everything below is generated in your browser, from what the record asserts. Here: a stored profile, no network needed.');
    await p.waitForTimeout(4200);
    await p.click('[data-sample]'); await p.waitForSelector('#tabs button', { timeout: 90000 }); await p.waitForTimeout(800);
    await p.addStyleTag({ content: '#result ~ *{display:none!important}' });
    seg('profile'); await toTabs(p);
    await caption(p, 'PROFILE', 'A biosketch you control.', 'Biography, affiliations and works come from the record. You choose the selection and the story.');
    await p.waitForTimeout(3000); await p.mouse.wheel(0, 420); await p.waitForTimeout(2600);
    seg('card'); await tab(p, 'Trading card');
    await caption(p, 'TRADING CARD', 'Print it. Pin it. Share it.', 'Years active become HP, outputs become attack, keywords become a special ability.');
    await p.waitForTimeout(5500);
    await tab(p, 'Heatmap');
    await caption(p, 'HEATMAP', 'Honest about fallow years.', 'One cell per month of publication activity, drawn only from dated outputs.');
    await p.waitForTimeout(5500);
    seg('wrapped'); await tab(p, 'Wrapped');
    await caption(p, 'WRAPPED', 'A year in review, no invented numbers.', 'Busiest month, longest gap, first-time venues. Every figure traces back to a field in the record.');
    await p.waitForTimeout(6500);
    await tab(p, 'Fortune');
    await caption(p, 'FORTUNE', 'Rediscover something you wrote.', 'A random title from your own record.');
    await p.waitForTimeout(5000);
    seg('check'); await tab(p, 'Record check');
    await caption(p, 'RECORD CHECK', 'Know what to fix, and why.', 'A scored rubric over your public record, with a concrete fix for every finding.');
    await p.waitForTimeout(4200); await p.mouse.wheel(0, 300); await p.waitForTimeout(4200); await p.mouse.wheel(0, 300); await p.waitForTimeout(3600);
    seg('funder'); await tab(p, 'Funder biosketch');
    await caption(p, 'FUNDER TEMPLATES', 'One record. NIH, ERC or Horizon.', 'Pre-filled only from asserted fields. Review and complete before submitting.');
    await p.waitForTimeout(4200); await p.mouse.wheel(0, 260); await p.waitForTimeout(2600);
    await p.selectOption('#panel select', { index: 1 }).catch(() => {}); await p.waitForTimeout(1200); await p.evaluate(() => document.querySelector('#tabs').scrollIntoView()); await p.waitForTimeout(4200);
    seg('citations'); await tab(p, 'Citations & data');
    await p.waitForTimeout(0);
    await caption(p, 'CITATIONS & DATA', 'Take your data with you.', 'BibTeX, RIS, CSL JSON, Schema.org JSON-LD and Markdown, with per-field provenance kept.');
    await p.waitForTimeout(8000);
    seg('end');
    segs.t0 = t0;
  });
  return { mp4, segs };
}

async function network(b, base) {
  const segs = [];
  const mp4 = await record(b, 'network', async (p, at) => {
    await p.goto(`${base}network/`); await p.waitForTimeout(9000);
    segs.t0 = at();
    await caption(p, 'RESEARCH NETWORK', 'Keep up with the people behind the research.', 'Follow public ORCID records and see their outputs in one feed. Everything stays in your browser.');
    await p.waitForTimeout(3800);
    await p.click('#demo'); await p.waitForTimeout(1500);
    await caption(p, 'SAMPLE DATA', 'Try it with a labelled sample.', 'Sample people and updates are marked Demo and kept apart from real imports.');
    await p.waitForTimeout(3600); await p.mouse.wheel(0, 360); await p.waitForTimeout(1800);
    await p.click('a[href="#people"]'); await p.waitForTimeout(800);
    await caption(p, 'PEOPLE', 'Follow by ORCID iD.', 'Paste an iD or profile link. Imports are manual and public-record only. No accounts, no tracking.');
    await p.waitForTimeout(4000);
    await p.click('a[href="#groups"]'); await p.waitForTimeout(800);
    await caption(p, 'WORKING GROUPS', 'Group outputs without confirming anyone.', 'Roster, roles and contributions are local decisions. Membership is never presented as verified.');
    await p.waitForTimeout(4400);
    segs.push({ id: 'end', t: at() });
  });
  return { mp4, segs };
}

const scenes = {
  async intro(b) {
    return record(b, 'intro', async (p) => {
      await p.setContent(card(`<h1>Your ORCID record,<br><em>re-expressed.</em></h1>
        <p>Biosketches, citations, funder templates and a little fun, built only from what your public ORCID record asserts.</p>
        <div><span class="pill">researcher-controlled</span><span class="pill">per-field provenance</span><span class="pill">runs in your browser</span></div>`));
      await p.waitForTimeout(5500);
    }).then(m => cut(m, 0.3, 5.5, resolve(RAW, 'intro-c.mp4')));
  },
  async outro(b) {
    return record(b, 'outro', async (p) => {
      await p.setContent(card(`<h1>ORCID supplies the facts.<br><em>You tell the story.</em></h1>
        <p>Open source · works offline after one visit · no server-side code.</p>
        <div><span class="pill">${SITE}</span><span class="pill">github.com/dhuzard/orcid-playground</span></div>`));
      await p.waitForTimeout(4800);
    }).then(m => cut(m, 0.3, 4.8, resolve(RAW, 'outro-c.mp4')));
  },
};

function square(src, dst) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=1080:-2,pad=1080:1080:0:(oh-ih)/2:color=0x143d37', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}
function concat(files, dst) {
  const list = resolve(RAW, 'list.txt');
  writeFileSync(list, files.map(f => `file '${f}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}
// Cut a topic out of a take: from its mark to the next listed mark.
function topic(take, segs, from, to, name) {
  const a = segs.find(s => s.id === from).t, z = segs.find(s => s.id === to).t;
  return cut(take, a + 0.15, z - 0.05, resolve(RAW, `${name}.mp4`));
}

for (const f of ['pyodide/0.26.4/pyodide.js', 'index.html']) if (!existsSync(resolve(SITE_DIR, f))) throw new Error(`${SITE_DIR} is not a built site (missing ${f}); run python scripts/build_site.py first`);
for (const f of readdirSync(OUT)) if (f.endsWith('.mp4')) rmSync(resolve(OUT, f));
const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', SITE_DIR], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));
const browser = await chromium.launch();
try {
  const base = `http://127.0.0.1:${PORT}/`;
  const intro = await scenes.intro(browser), outro = await scenes.outro(browser);
  const st = await studio(browser, base), nw = await network(browser, base);
  const S = (a, z, n) => topic(st.mp4, st.segs, a, z, n);
  const studioAll = cut(st.mp4, st.segs.t0 + 0.1, st.segs.find(s => s.id === 'end').t - 0.05, resolve(RAW, 'studio-all.mp4'));
  const netAll = cut(nw.mp4, nw.segs.t0 + 0.1, nw.segs.find(x => x.id === 'end').t - 0.05, resolve(RAW, 'network-all.mp4'));
  concat([intro, studioAll, netAll, outro], resolve(OUT, 'orcid-playground-full-demo.mp4'));
  const clips = {
    'clip-1-record-check': S('check', 'funder', 'k1'), 'clip-2-funder-templates': S('funder', 'citations', 'k2'),
    'clip-3-wrapped': S('wrapped', 'check', 'k3'), 'clip-4-card-and-heatmap': S('card', 'wrapped', 'k4'),
    'clip-5-research-network': netAll, 'clip-6-citations-and-data': S('citations', 'end', 'k6'),
    'clip-0-teaser': intro,
  };
  for (const [name, src] of Object.entries(clips)) square(src, resolve(OUT, `${name}.mp4`));
} finally { await browser.close(); server.kill(); }
