// <orcid-group src="group.json"> renders a group snapshot made by the playground's
// group view (schema "orcid-group-snapshot/1"): members and a searchable, merged
// bibliography. All text comes from public ORCID records and is untrusted, so it
// is only ever set as text, and links are limited to http(s).
export const SCHEMA = "orcid-group-snapshot/1";

export function safeHttpUrl(value, base = document.baseURI) {
  try {
    const url = new URL(String(value || ""), base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function validSnapshot(data) {
  return Boolean(data && data.schema === SCHEMA && typeof data.name === "string"
    && Array.isArray(data.members) && Array.isArray(data.works));
}

// Newest first, filtered by a case-insensitive query over title, venue and member names.
export function filterWorks(data, query = "", names = new Map()) {
  const needle = query.trim().toLowerCase();
  return data.works
    .filter(w => w && typeof w === "object")
    .filter(w => !needle || [w.title, w.journal, ...(w.asserted_by || []).map(id => names.get(id) || "")]
      .some(text => String(text || "").toLowerCase().includes(needle)))
    .sort((a, b) => String(b.publication_date || "").localeCompare(String(a.publication_date || "")));
}

const STYLE = `
:host{display:block;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--orcid-group-ink,#18332e)}
h2{font:400 1.6rem Georgia,serif;margin:0 0 4px}
.muted{color:var(--orcid-group-muted,#5d6b66);font-size:.85rem}
.members{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:12px 0}
.members a{display:inline-block;border:1px solid #dce3da;border-radius:999px;padding:4px 12px;text-decoration:none;color:inherit}
input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dce3da;border-radius:10px;font:inherit;margin:8px 0 12px}
ol{list-style:none;padding:0;margin:0}
li.work{border-bottom:1px solid #dce3da;padding:8px 0}
.title{font-weight:600}
.shared{background:#d9ed8d;border-radius:999px;padding:0 8px;font-size:.75rem;margin-left:6px}
a{color:var(--orcid-group-link,#143d37)}
`;

class OrcidGroup extends HTMLElement {
  static observedAttributes = ["src", "limit"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.loadVersion = 0;
  }

  connectedCallback() { this.load(); }
  attributeChangedCallback() { if (this.isConnected) this.load(); }

  el(tag, text, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  message(text) {
    const style = this.el("style", STYLE);
    this.shadowRoot.replaceChildren(style, this.el("p", text, "muted"));
  }

  async load() {
    const version = ++this.loadVersion;
    const src = this.getAttribute("src");
    if (!src) return this.message("Missing src attribute.");
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (version !== this.loadVersion) return;
      if (!validSnapshot(data)) throw new Error("not an ORCID group snapshot");
      this.data = data;
      this.render("");
    } catch (error) {
      if (version === this.loadVersion) this.message(`Could not load the group: ${error.message}`);
    }
  }

  render(query) {
    const data = this.data;
    const names = new Map(data.members.map(m => [m.orcid, String(m.name || m.orcid || "")]));
    const shared = new Set(data.shared_dois || []);
    const limit = Number(this.getAttribute("limit")) || 50;
    const works = filterWorks(data, query, names);

    const members = this.el("ul", null, "members");
    for (const member of data.members) {
      const item = this.el("li");
      const link = this.el("a", names.get(member.orcid) || "Member");
      const href = safeHttpUrl(`https://orcid.org/${encodeURIComponent(String(member.orcid || ""))}`);
      if (href) { link.href = href; link.target = "_blank"; link.rel = "noopener"; }
      item.append(link);
      members.append(item);
    }

    const search = this.el("input");
    search.type = "search";
    search.placeholder = "Search outputs";
    search.setAttribute("aria-label", "Search the group's outputs");
    search.value = query;
    search.addEventListener("input", () => {
      const position = search.selectionStart;
      this.render(search.value);
      const next = this.shadowRoot.querySelector("input");
      next.focus();
      next.setSelectionRange(position, position);
    });

    const list = this.el("ol");
    for (const work of works.slice(0, limit)) {
      const item = this.el("li", null, "work");
      const title = this.el("span", work.title || "Untitled", "title");
      const doiUrl = work.doi ? safeHttpUrl(`https://doi.org/${work.doi}`) : "";
      const url = doiUrl || safeHttpUrl(work.url);
      if (url) {
        const link = this.el("a");
        link.href = url; link.target = "_blank"; link.rel = "noopener";
        link.append(title);
        item.append(link);
      } else item.append(title);
      if (work.doi && shared.has(work.doi)) item.append(this.el("span", "joint", "shared"));
      const meta = [String(work.publication_date || "").slice(0, 4), work.journal,
        (work.asserted_by || []).map(id => names.get(id) || id).join(", ")].filter(Boolean).join(" · ");
      item.append(this.el("div", meta, "muted"));
      list.append(item);
    }

    const footer = this.el("p", `${works.length} of ${data.works.length} outputs${works.length > limit ? `, showing ${limit}` : ""}. `
      + `From public ORCID records, ${data.provenance?.generated_at || ""}. ${data.provenance?.membership || ""}`, "muted");
    this.shadowRoot.replaceChildren(this.el("style", STYLE), this.el("h2", data.name), members, search, list, footer);
  }
}

if (!customElements.get("orcid-group")) customElements.define("orcid-group", OrcidGroup);
