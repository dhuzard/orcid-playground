// Renders the ORCID Playground Studio + network demo from the web app's UI only (see demo/README.md).
//   node demo/render.mjs [site-dir]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { readdirSync, rmSync } from 'node:fs';
import { OUT, RAW, SITE, caption, record, cut, card, square, concat, topic, titleCard, serveSite } from './lib.mjs';

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

const site = await serveSite();
const browser = await chromium.launch();
try {
  const base = site.base;
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
} finally { await browser.close(); site.stop(); }
