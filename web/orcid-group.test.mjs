import assert from "node:assert/strict";
import test from "node:test";

globalThis.document = { baseURI: "https://lab.example/team/" };
globalThis.HTMLElement = class {};
globalThis.customElements = { get() { return true; }, define() {} };

const { safeHttpUrl, validSnapshot, filterWorks, SCHEMA } = await import("./orcid-group.js");

const snapshot = {
  schema: SCHEMA, name: "Lab", members: [{ orcid: "0000-0000-0000-0001", name: "Ada" }],
  works: [
    { title: "Old", publication_date: "2019", asserted_by: ["0000-0000-0000-0001"] },
    { title: "New methods", publication_date: "2024", journal: "J Open", asserted_by: [] },
    null,
  ],
};

test("only http(s) links survive", () => {
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("/paper"), "https://lab.example/paper");
});

test("snapshots must declare the schema and lists", () => {
  assert.equal(validSnapshot(snapshot), true);
  assert.equal(validSnapshot({ ...snapshot, schema: "other" }), false);
  assert.equal(validSnapshot({ ...snapshot, works: "x" }), false);
  assert.equal(validSnapshot(null), false);
});

test("works are newest first and searchable by title, venue and member", () => {
  const names = new Map([["0000-0000-0000-0001", "Ada"]]);
  assert.deepEqual(filterWorks(snapshot).map(w => w.title), ["New methods", "Old"]);
  assert.deepEqual(filterWorks(snapshot, "open").map(w => w.title), ["New methods"]);
  assert.deepEqual(filterWorks(snapshot, "ada", names).map(w => w.title), ["Old"]);
});
