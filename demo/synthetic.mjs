// Synthetic ORCID records for the group demo: four fictional researchers, clearly labelled "Demo".
// Served in place of pub.orcid.org so the Group view can run without the live API. DOIs use Crossref's
// 10.5555 test prefix. They are not real people, works or assertions.
const checksum = (d) => { let t = 0; for (const c of d) t = (t + Number(c)) * 2; const r = (12 - (t % 11)) % 11; return r === 10 ? 'X' : String(r); };
const fmt = (b) => { const d = b + checksum(b); return `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8, 12)}-${d.slice(12)}`; };

const W = {
  guide: ['[Demo] A practical guide to open research teams', '2024', 'journal-article', '10.5555/demo.guide'],
  data: ['[Demo] Sharing preclinical data without losing context', '2025', 'journal-article', '10.5555/demo.data'],
  meta: ['[Demo] A metadata checklist for shared datasets', '2023', 'preprint', '10.5555/demo.meta'],
  tool: ['[Demo] A small toolkit for reproducible analysis', '2022', 'software', '10.5555/demo.tool'],
  stats: ['[Demo] Reporting uncertainty in small cohorts', '2021', 'journal-article', '10.5555/demo.stats'],
  review: ['[Demo] Community standards: a short review', '2026', 'journal-article', '10.5555/demo.review'],
  solo1: ['[Demo] Notes on onboarding new lab members', '2025', 'book-chapter', '10.5555/demo.solo1'],
  solo2: ['[Demo] Field notes on collaborative writing', '2024', 'journal-article', '10.5555/demo.solo2'],
  solo3: ['[Demo] Teaching data stewardship', '2023', 'journal-article', '10.5555/demo.solo3'],
};
const PEOPLE = [
  ['Ada', 'Rivera', 'Open methods and reproducibility', ['guide', 'data', 'meta', 'solo1', 'stats'], ['reproducibility', 'open science']],
  ['Sam', 'Okafor', 'Research data management', ['guide', 'data', 'tool', 'solo2'], ['datasets', 'collaboration']],
  ['Lena', 'Marchetti', 'Biostatistics', ['meta', 'tool', 'stats', 'review', 'solo3'], ['statistics', 'methods']],
  ['Noor', 'Haddad', 'Community standards', ['review', 'guide'], ['standards', 'FAIR']],
];
export const demoPeople = PEOPLE.map(([given, family, headline, works, keywords], i) => ({
  orcid: fmt(`00000000000${String(i + 1).padStart(3, '0')}`.slice(-15).padStart(15, '0')), given, family, headline, works, keywords,
}));
const recordFor = (p) => ({
  'orcid-identifier': { path: p.orcid },
  history: { 'last-modified-date': { value: Date.UTC(2026, 9, 1) } },
  person: {
    name: { 'given-names': { value: p.given }, 'family-name': { value: `${p.family} (Demo)` } },
    biography: { content: `${p.headline}. Fictional researcher for the ORCID Playground demo.` },
    keywords: { keyword: p.keywords.map(content => ({ content })) },
    'researcher-urls': { 'researcher-url': [] },
    addresses: { address: [] },
  },
  'activities-summary': {
    employments: { 'affiliation-group': [] }, educations: { 'affiliation-group': [] }, fundings: { group: [] },
    works: { group: p.works.map((key, n) => ({ 'work-summary': [{
      title: { title: { value: W[key][0] } }, type: W[key][2], 'put-code': 100 + n,
      'publication-date': { year: { value: W[key][1] }, month: { value: String(1 + ((n * 3 + p.orcid.length) % 12)).padStart(2, '0') } },
      'journal-title': { value: 'Journal of Open Research (Demo)' },
      'external-ids': { 'external-id': [{ 'external-id-type': 'doi', 'external-id-value': W[key][3] }] },
    }] })) },
  },
});
// Route pub.orcid.org/v3.0/<iD>/record to the synthetic record; anything else is refused.
export async function serveSyntheticOrcid(context) {
  await context.route('https://pub.orcid.org/**', async (route) => {
    const m = new URL(route.request().url()).pathname.match(/\/v3\.0\/([\dX-]+)\/record$/);
    const p = m && demoPeople.find(x => x.orcid === m[1]);
    if (!p) return route.fulfill({ status: 404, body: '{}' });
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(recordFor(p)) });
  });
}
