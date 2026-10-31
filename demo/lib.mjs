// Shared helpers for the demo renderers (render.mjs, groups.mjs).
import { chromium } from 'playwright';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(ROOT, 'demo/out');
export const RAW = resolve(OUT, '.raw');
export const SITE = 'orcid-playground-889.web.app';
export const W = 1280, H = 720, PORT = 8899;
export const SITE_DIR = resolve(process.argv[2] || resolve(ROOT, 'site'));
mkdirSync(RAW, { recursive: true });

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const CSS = `
:root{--ink:#143d37;--lime:#d6ea7a;--cream:#f6f5ef;--mute:#9db8b0}
*{box-sizing:border-box;margin:0}body{width:${W}px;height:${H}px;background:var(--ink);color:var(--cream);font:16px Inter,system-ui,sans-serif;overflow:hidden}
.mark{position:absolute;left:36px;top:28px;display:flex;gap:12px;align-items:center;font-weight:600;letter-spacing:.02em}
.mark b{background:var(--lime);color:var(--ink);width:36px;height:36px;border-radius:9px;display:grid;place-items:center;font:700 22px Georgia,serif}
.site{position:absolute;right:36px;top:36px;color:var(--mute);font-size:14px;letter-spacing:.06em}
`;
export const CAPCSS = `
#cap{position:fixed;left:36px;right:36px;bottom:26px;padding:18px 28px 20px;background:#143d37!important;border:1px solid #2c5a51;border-radius:16px;box-shadow:0 12px 40px #0006;z-index:99999;pointer-events:none;opacity:0;transition:opacity .5s}
#cap.on{opacity:1}#cap *{margin:0!important;font-family:Inter,system-ui,sans-serif!important;color:#f6f5ef!important;background:none!important}
#cap i{font-style:normal;color:#d6ea7a!important;font-size:13px;letter-spacing:.14em;display:block;margin-bottom:6px!important}
#cap h2{font:400 34px Georgia,serif!important;margin-bottom:6px!important}#cap p{font-size:19px;color:#d6e3dd!important;line-height:1.35}`;

export async function caption(page, kicker, title, text) {
  await page.evaluate(([k, t, x, css]) => {
    if (!document.getElementById('capcss')) { const s = document.createElement('style'); s.id = 'capcss'; s.textContent = css; document.head.append(s); }
    let c = document.getElementById('cap'); if (!c) { c = document.createElement('div'); c.id = 'cap'; document.body.append(c); }
    c.classList.remove('on');
    setTimeout(() => { c.innerHTML = `<i>${k}</i><h2>${t}</h2><p>${x}</p>`; c.classList.add('on'); }, 350);
  }, [kicker, title, text, CAPCSS]);
}

// Record one take to mp4. `body(page, at)` runs the take; at() returns seconds since the video began.
export async function record(browser, id, body, setup) {
  const dir = resolve(RAW, id); rmSync(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, bypassCSP: true, recordVideo: { dir, size: { width: W, height: H } } });
  if (setup) await setup(ctx);
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
export function cut(src, from, to, dst) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(from), '-to', String(to), '-i', src, '-r', '30', '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-an', dst]);
  return dst;
}

export const card = (inner) => `<style>${CSS}.c{position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:60px}
h1{font:400 76px/1.05 Georgia,serif;max-width:1000px}h1 em{color:var(--lime);font-style:normal}p{margin-top:24px;font-size:24px;color:#cfe0d9;max-width:880px;line-height:1.4;margin-inline:auto}
.pill{display:inline-block;margin:26px 6px 0;padding:8px 16px;border:1px solid #3f776b;border-radius:99px;font-size:17px;color:var(--lime)}</style>
<div class="mark"><b>o.</b>ORCID Playground</div><div class="site">${SITE}</div><div class="c">${inner}</div>`;


export function square(src, dst) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', 'scale=1080:-2,pad=1080:1080:0:(oh-ih)/2:color=0x143d37', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}
export function concat(files, dst) {
  const list = resolve(RAW, 'list.txt');
  writeFileSync(list, files.map(f => `file '${f}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dst]);
}
// Cut a topic out of a take: from one mark to another.
export function topic(take, segs, from, to, name) {
  const a = segs.find(s => s.id === from).t, z = segs.find(s => s.id === to).t;
  return cut(take, a + 0.15, z - 0.05, resolve(RAW, `${name}.mp4`));
}
// A title or closing card as a short clip.
export async function titleCard(b, id, html, seconds) {
  const m = await record(b, id, async (p) => { await p.setContent(card(html)); await p.waitForTimeout((seconds + 0.5) * 1000); });
  return cut(m, 0.3, seconds + 0.3, resolve(RAW, `${id}-c.mp4`));
}
// Serve the built site locally; resolves to its base URL and a stop function.
export async function serveSite() {
  for (const f of ['pyodide/0.26.4/pyodide.js', 'index.html']) if (!existsSync(resolve(SITE_DIR, f))) throw new Error(`${SITE_DIR} is not a built site (missing ${f}); run python scripts/build_site.py first`);
  const server = spawn('python', ['-m', 'http.server', String(PORT), '--directory', SITE_DIR], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  return { base: `http://127.0.0.1:${PORT}/`, stop: () => server.kill() };
}
