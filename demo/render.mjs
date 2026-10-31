// Renders the ORCID Playground demo: one full cut plus square LinkedIn clips.
// Everything shown comes from real program output on the stored record (generated/biosketch.json)
// or the local network pilot's labelled sample data. Nothing is mocked or invented.
//   node demo/render.mjs            (needs: pip install -e ., playwright, ffmpeg)
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'demo/out');
const RAW = resolve(OUT, '.raw');
const BIO = 'generated/biosketch.json';
const SITE = 'orcid-playground-889.web.app';
const W = 1280, H = 720, PORT = 8899;
mkdirSync(RAW, { recursive: true });

const sh = (args) => execFileSync('orcid-biosketch', args, { cwd: ROOT, encoding: 'utf8' });
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = (f) => readFileSync(resolve(ROOT, 'generated', f), 'utf8');

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

// Record one scene to a webm, then encode to mp4.
async function record(browser, id, body) {
  const dir = resolve(RAW, id); rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, bypassCSP: true, recordVideo: { dir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  await body(page);
  await ctx.close();
  const webm = readdirSync(dir).find(f => f.endsWith('.webm'));
  const mp4 = resolve(RAW, `${id}.mp4`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '0.25', '-i', resolve(dir, webm), '-r', '30', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-an', mp4]);
  console.log('scene', id);
  return mp4;
}

const termPage = (title) => `<style>${CSS}
.win{position:absolute;left:36px;right:36px;top:86px;bottom:205px;background:#0c2622;border:1px solid #2c5a51;border-radius:14px;overflow:hidden;box-shadow:0 20px 60px #0008}
.bar{height:34px;background:#0f2f29;display:flex;gap:8px;align-items:center;padding:0 14px;color:var(--mute);font-size:13px}
.bar span{width:11px;height:11px;border-radius:50%;background:#2c5a51}
pre{padding:16px 22px;font:15.5px/1.38 'DejaVu Sans Mono',monospace;color:#dfeee8;white-space:pre-wrap;height:calc(100% - 34px);overflow:hidden}
.p{color:var(--lime)}.cur{display:inline-block;width:9px;height:17px;background:var(--lime);vertical-align:-3px;animation:b 1s steps(1) infinite}@keyframes b{50%{opacity:0}}
</style><div class="mark"><b>o.</b>ORCID Playground</div><div class="site">${SITE}</div>
<div class="win"><div class="bar"><span></span><span></span><span></span>&nbsp; ${esc(title)}</div><pre id="t"></pre></div>`;

async function terminal(page, cmd, output, { show = 18, perLine = 70, hold = 4000 } = {}) {
  const lines = output.replace(/\s+$/, '').split('\n');
  await page.setContent(termPage('~/orcid-playground'));
  await page.evaluate(async ([cmd, lines, show, perLine]) => {
    const t = document.getElementById('t'); const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const shown = [];
    const render = (typed) => { t.innerHTML = `<span class="p">$</span> ${typed}<span class="cur"></span>\n` + shown.slice(-show).map(s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('\n'); };
    let typed = ''; for (const ch of cmd) { typed += ch.replace('&', '&amp;').replace('<', '&lt;'); render(typed); await sleep(38); }
    await sleep(500);
    for (const l of lines) { shown.push(l); render(typed); await sleep(perLine); }
  }, [cmd, lines, show, perLine]);
  await page.waitForTimeout(hold);
}

const card = (inner, extra = '') => `<style>${CSS}.c{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:60px}
h1{font:400 76px/1.05 Georgia,serif;max-width:1000px}h1 em{color:var(--lime);font-style:normal}p{margin-top:24px;font-size:24px;color:#cfe0d9;max-width:880px;line-height:1.4;margin-inline:auto}
.pill{display:inline-block;margin:26px 6px 0;padding:8px 16px;border:1px solid #3f776b;border-radius:99px;font-size:17px;color:var(--lime)}${extra}</style>
<div class="mark"><b>o.</b>ORCID Playground</div><div class="site">${SITE}</div><div class="c">${inner}</div>`;

const scenes = {
  async intro(b) {
    return record(b, 'intro', async (p) => {
      await p.setContent(card(`<h1>Your ORCID record,<br><em>re-expressed.</em></h1>
        <p>Biosketches, citations, funder templates and a little fun — built only from what your public ORCID record asserts.</p>
        <div><span class="pill">researcher-controlled</span><span class="pill">per-field provenance</span><span class="pill">works offline</span></div>`));
      await p.waitForTimeout(6000);
    });
  },
  async lint(b) {
    const out = sh(['lint', '--biosketch', BIO]).split('\n');
    const view = [...out.slice(0, 22), '  ...'].join('\n');
    return record(b, 'lint', async (p) => {
      await terminal(p, `orcid-biosketch lint --biosketch ${BIO}`, view, { show: 19, perLine: 120, hold: 3500 });
      await caption(p, 'RECORD CHECK', 'Know what to fix, and why.', 'A scored rubric over your public record — missing identifiers, unresolvable affiliations, duplicate works — each with a concrete fix.');
      await p.waitForTimeout(6000);
    });
  },
  async nih(b) {
    const out = sh(['export', '--biosketch', BIO, '--template', 'nih']).split('\n').filter(l => l.trim()).map(l => l.length > 118 ? l.slice(0, 115) + '...' : l);
    const view = out.slice(0, 14).join('\n') + '\n...';
    return record(b, 'nih', async (p) => {
      await terminal(p, `orcid-biosketch export --biosketch ${BIO} --template nih`, view, { show: 14, perLine: 260, hold: 2500 });
      await caption(p, 'FUNDER TEMPLATES', 'One record. NIH, ERC or Horizon.', 'Position, appointments and products fill the template from your ORCID assertions. The narrative stays yours.');
      await p.waitForTimeout(6500);
    });
  },
  async wrapped(b) {
    const out = sh(['wrapped', '--biosketch', BIO, '--year', '2025']);
    const view = out.split('\n').slice(0, 25).join('\n');
    return record(b, 'wrapped', async (p) => {
      await terminal(p, `orcid-biosketch wrapped --biosketch ${BIO} --year 2025`, view, { show: 19, perLine: 110, hold: 2500 });
      await caption(p, 'WRAPPED', 'A year in review — no invented numbers.', 'Top venue, busiest month, longest gap, and how the vocabulary of your titles drifted. Every figure traces back to a field in the record.');
      await p.waitForTimeout(6500);
    });
  },
  async fun(b) {
    const fortune = sh(['fortune', '--biosketch', BIO]).trim();
    return record(b, 'fun', async (p) => {
      await p.setContent(`<style>${CSS}
      .row{position:absolute;left:0;right:0;top:84px;display:flex;justify-content:center;gap:56px;align-items:flex-start}
      .row>div{opacity:0;transform:translateY(24px);transition:all .8s}.row>div.on{opacity:1;transform:none}
      .row svg{height:420px;width:auto;border-radius:14px;box-shadow:0 18px 50px #0009;background:#fbfaf7}
      .fortune{position:absolute;left:60px;right:60px;top:92px;font:italic 30px/1.4 Georgia,serif;color:var(--lime);text-align:center;opacity:0;transition:opacity .8s}
      </style><div class="mark"><b>o.</b>ORCID Playground</div><div class="site">${SITE}</div>
      <div class="row"><div id="a">${svg('card.svg')}</div><div id="b">${svg('heatmap.svg')}</div></div>`);
      await p.waitForTimeout(500);
      await p.evaluate(() => document.getElementById('a').classList.add('on'));
      await p.waitForTimeout(1500);
      await p.evaluate(() => document.getElementById('b').classList.add('on'));
      await caption(p, 'TRADING CARD · HEATMAP', 'Print it. Pin it. Share it.', 'Years active become HP, outputs become attack, keywords become a special ability. The heatmap is honest about fallow years, too.');
      await p.waitForTimeout(7000);
    });
  },
  async network(b, url) {
    return record(b, 'network', async (p) => {
      await p.goto(url); await p.click('#demo'); await p.waitForTimeout(1200);
      await caption(p, 'RESEARCH NETWORK · LOCAL PILOT', 'Keep up with the people behind the research.', 'A feed of public outputs from researchers you follow. Sample data is always labelled Demo.');
      await p.waitForTimeout(3500);
      await p.mouse.wheel(0, 360); await p.waitForTimeout(1800);
      await p.click('a[href="#people"]'); await p.waitForTimeout(800);
      await caption(p, 'PEOPLE', 'Follow by ORCID iD.', 'Paste an iD or profile link. Imports are manual, public-record only — no accounts, no tracking.');
      await p.waitForTimeout(3800);
      await p.click('a[href="#groups"]'); await p.waitForTimeout(800);
      await caption(p, 'WORKING GROUPS', 'Group outputs without confirming anyone.', 'Roster, roles and contributions are local decisions. Membership is never presented as verified.');
      await p.waitForTimeout(4200);
    });
  },
  async outro(b) {
    return record(b, 'outro', async (p) => {
      await p.setContent(card(`<h1>ORCID supplies the facts.<br><em>You tell the story.</em></h1>
        <p>Open source · offline-capable · no server-side code.</p>
        <div><span class="pill">${SITE}</span><span class="pill">github.com/dhuzard/orcid-playground</span></div>`));
      await p.waitForTimeout(5000);
    });
  },
};

// 1080x1080 LinkedIn version: scale the 16:9 scene and centre it on the brand colour.
function square(src, dst) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=1080:-2,pad=1080:1080:0:(oh-ih)/2:color=0x143d37', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}
function concat(files, dst) {
  const list = resolve(RAW, 'list.txt');
  writeFileSync(list, files.map(f => `file '${f}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}

const server = spawn('python', ['-m', 'orcid_biosketch.network', '--port', String(PORT), '--data', resolve(RAW, 'net.sqlite3')], { cwd: ROOT, stdio: 'ignore' });
rmSync(resolve(RAW, 'net.sqlite3'), { force: true });
await new Promise(r => setTimeout(r, 2000));
const browser = await chromium.launch();
try {
  const m = {};
  for (const id of ['intro', 'lint', 'nih', 'wrapped', 'fun', 'network', 'outro']) m[id] = await scenes[id](browser, `http://127.0.0.1:${PORT}/`);
  concat(['intro', 'lint', 'nih', 'wrapped', 'fun', 'network', 'outro'].map(i => m[i]), resolve(OUT, 'orcid-playground-full-demo.mp4'));
  const clips = { 'clip-1-record-check': 'lint', 'clip-2-funder-templates': 'nih', 'clip-3-wrapped': 'wrapped', 'clip-4-card-and-heatmap': 'fun', 'clip-5-research-network': 'network' };
  for (const [name, id] of Object.entries(clips)) square(m[id], resolve(OUT, `${name}.mp4`));
  square(m.intro, resolve(OUT, 'clip-0-teaser.mp4'));
} finally { await browser.close(); server.kill(); }
