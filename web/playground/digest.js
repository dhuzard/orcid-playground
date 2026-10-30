// "What's new since your last visit": a Markdown digest of the outputs the
// research network observed after a given time. Observation dates come from the
// visitor's own refreshes; publication dates are reported separately.
export function buildDigest(state, since) {
  const people = new Map((state.people || []).map(p => [p.id, p]));
  const works = new Map((state.works || []).map(w => [w.id, w]));
  const cutoff = since ? Date.parse(since) : 0;
  const events = (state.events || [])
    .filter(e => e && Date.parse(e.observed_at) > cutoff && works.has(e.work_id))
    .sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at)));
  const heading = since ? `since ${new Date(cutoff).toISOString().slice(0, 10)}` : 'so far';
  const lines = [`# What's new ${heading}`, '',
    `${events.length} new output${events.length === 1 ? '' : 's'} observed in the public ORCID records you follow.`, ''];
  for (const event of events) {
    const work = works.get(event.work_id);
    const names = (event.people_ids || []).map(id => people.get(id)?.name || id).join(', ');
    const link = work.doi ? `https://doi.org/${work.doi}` : work.url || '';
    lines.push(`- **${work.title || 'Untitled'}**${work.date ? ` (${work.date})` : ''}, ${names}.`
      + `${link ? ` ${link}` : ''} Observed ${String(event.observed_at).slice(0, 10)}.`);
  }
  lines.push('', '_From public ORCID records. "Observed" is when your refresh first saw an output, not its publication date._');
  return { count: events.length, markdown: lines.join('\n') + '\n' };
}
