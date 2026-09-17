import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryLibraryItems, createSharePointLibrary, normalizeLibraryPath, InvalidLibraryPathError } from "./sharepointLibrary";

const config = { site_id: "site,aaa,bbb", drive_id: "drive-1" };

function graphReturning(pages: Array<{ status?: number; body?: unknown }>) {
  const urls: string[] = [];
  let call = 0;
  const fetchGraph = async (input: string | URL | Request) => {
    urls.push(String(input));
    const page = pages[Math.min(call++, pages.length - 1)];
    return new Response(page.body === undefined ? "" : JSON.stringify(page.body), { status: page.status ?? 200 });
  };
  return { urls, fetchGraph };
}

const folder = (name: string, childCount = 2) => ({ id: `id-${name}`, name, folder: { childCount } });
const file = (name: string, mime = "application/pdf") => ({ id: `id-${name}`, name, file: { mimeType: mime }, size: 10, eTag: `etag-${name}`, lastModifiedDateTime: "2026-09-01T00:00:00Z", webUrl: `https://sp/${name}` });

test("a path is normalised to the form Graph is asked for", () => {
  assert.equal(normalizeLibraryPath(""), "");
  assert.equal(normalizeLibraryPath(null), "");
  assert.equal(normalizeLibraryPath("/"), "");
  assert.equal(normalizeLibraryPath("/_SOPs/_OCC Documents/"), "_SOPs/_OCC Documents");
});

// The application's own Sites.Selected grant is the guarantee that matters.
// These are the second line: a path that would change which item Graph
// addresses is refused here rather than encoded and hoped for.
test("a path that would escape the configured library is refused", () => {
  for (const bad of ["../secrets", "_SOPs/../../etc", "x/./y", "a//b", "a:b", "a\\b"]) {
    assert.throws(() => normalizeLibraryPath(bad), InvalidLibraryPathError, `expected ${bad} to be refused`);
  }
});

test("the site and drive come from configuration, never from the path", async () => {
  const { urls, fetchGraph } = graphReturning([{ body: { value: [] } }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  await library.listFolder("_SOPs");
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes(encodeURIComponent(config.site_id)), "the configured site must be addressed");
  assert.ok(urls[0].includes(encodeURIComponent(config.drive_id)), "the configured drive must be addressed");
});

test("folders sort before files, each alphabetically", async () => {
  const { fetchGraph } = graphReturning([{ body: { value: [file("zebra.pdf"), folder("_Review"), file("alpha.pdf"), folder("_Drafts")] } }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("");
  assert.equal(listing.outcome, "ok");
  if (listing.outcome !== "ok") return;
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["_Drafts", "_Review", "alpha.pdf", "zebra.pdf"]);
});

test("a folder path is carried onto each child, so the picker can descend without rebuilding it", async () => {
  const { fetchGraph } = graphReturning([{ body: { value: [folder("_OCC Documents")] } }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("_SOPs");
  assert.equal(listing.outcome, "ok");
  if (listing.outcome !== "ok") return;
  assert.equal(listing.entries[0].path, "_SOPs/_OCC Documents");
});

// A library folder of SOPs runs past one page, and a picker that silently
// showed the first 200 would look complete while hiding the rest.
test("every page of a long folder is read", async () => {
  const { fetchGraph } = graphReturning([
    { body: { value: [file("one.pdf")], "@odata.nextLink": "https://graph.microsoft.com/next" } },
    { body: { value: [file("two.pdf")] } },
  ]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("");
  assert.equal(listing.outcome, "ok");
  if (listing.outcome !== "ok") return;
  assert.deepEqual(listing.entries.map((entry) => entry.name), ["one.pdf", "two.pdf"]);
});

test("a library OnBoard was never granted is forbidden, not empty and not missing", async () => {
  const { fetchGraph } = graphReturning([{ status: 403 }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("");
  assert.equal(listing.outcome, "forbidden");
  assert.match(listing.reason, /SharePoint administrator must grant the OnBoard application read access on this site/);
  assert.match(listing.reason, /not a missing folder/);
  // Sites.Selected is already consented; the per-site grant is a SharePoint
  // act, and sending people to Entra for it cost three days in 2026-09.
  assert.doesNotMatch(listing.reason, /Entra/);
});

test("a token SharePoint refuses is forbidden, and does not point at the site grant", async () => {
  const { fetchGraph } = graphReturning([{ status: 401 }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("");
  assert.equal(listing.outcome, "forbidden");
  assert.match(listing.reason, /did not accept OnBoard's sign-in/);
  assert.match(listing.reason, /site grant will not fix it/);
});

test("a folder that is not there is not_found, and says nothing about permissions", async () => {
  const { fetchGraph } = graphReturning([{ status: 404 }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("_SOPs/nope");
  assert.equal(listing.outcome, "not_found");
  assert.doesNotMatch(listing.reason, /granted|permission/i);
});

test("an outage is a failure, distinct from both", async () => {
  const { fetchGraph } = graphReturning([{ status: 503 }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("");
  assert.equal(listing.outcome, "failed");
});

test("an empty folder is ok and empty, not an error", async () => {
  const { fetchGraph } = graphReturning([{ body: { value: [] } }]);
  const library = createSharePointLibrary(config, async () => "token", fetchGraph);
  const listing = await library.listFolder("_SOPs/_Drafts");
  assert.equal(listing.outcome, "ok");
  if (listing.outcome !== "ok") return;
  assert.deepEqual(listing.entries, []);
});

test("the unreadable answers do not share a message", async () => {
  const reasons = new Set<string>();
  for (const status of [401, 403, 404, 503]) {
    const { fetchGraph } = graphReturning([{ status }]);
    const listing = await createSharePointLibrary(config, async () => "token", fetchGraph).listFolder("_SOPs");
    if (listing.outcome !== "ok") reasons.add(listing.reason);
  }
  assert.equal(reasons.size, 4, `expected four distinct reasons, got ${JSON.stringify([...reasons])}`);
});

test("a chosen item is read inside the configured library, as SharePoint describes it now", async () => {
  const { urls, fetchGraph } = graphReturning([{ body: file("SOP-1.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") }]);
  const read = await createSharePointLibrary(config, async () => "token", fetchGraph).readItem("item/../other");
  assert.deepEqual(read, {
    outcome: "ok",
    item: { site_id: config.site_id, drive_id: config.drive_id, item_id: "id-SOP-1.docx", name: "SOP-1.docx", kind: "file", mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", etag: "etag-SOP-1.docx", web_url: "https://sp/SOP-1.docx" },
  });
  assert.equal(urls[0], `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(config.site_id)}/drives/drive-1/items/item%2F..%2Fother?$select=id,name,folder,file,eTag,webUrl`);
});

test("a chosen folder is reported as a folder, so it cannot pass for a document", async () => {
  const { fetchGraph } = graphReturning([{ body: folder("_SOPs") }]);
  const read = await createSharePointLibrary(config, async () => "token", fetchGraph).readItem("id-_SOPs");
  assert.equal(read.outcome === "ok" && read.item.kind, "folder");
});

// Reading one item refuses in the same words as listing a folder, so the
// picker and the Draft save never describe one fault two ways.
test("reading an item keeps apart a missing grant, a refused sign-in, a missing item and an outage", async () => {
  const answers = [];
  for (const status of [403, 401, 404, 400, 503]) {
    const { fetchGraph } = graphReturning([{ status }]);
    answers.push(await createSharePointLibrary(config, async () => "token", fetchGraph).readItem("item-1"));
  }
  assert.deepEqual(answers.map((answer) => answer.outcome), ["forbidden", "forbidden", "not_found", "not_found", "failed"]);
  const { fetchGraph } = graphReturning([{ status: 403 }]);
  const listing = await createSharePointLibrary(config, async () => "token", fetchGraph).listFolder("");
  assert.equal(answers[0].outcome !== "ok" && answers[0].reason, listing.outcome !== "ok" && listing.reason);
});

test("a token that cannot be acquired is a failed read, not a thrown error", async () => {
  const { urls, fetchGraph } = graphReturning([{ body: {} }]);
  const read = await createSharePointLibrary(config, async () => { throw new Error("AADSTS7000222: client secret expired"); }, fetchGraph).readItem("item-1");
  assert.deepEqual(read, { outcome: "failed", reason: "SharePoint could not be read: AADSTS7000222: client secret expired" });
  assert.equal(urls.length, 0);
});

test("the in-memory library answers from its items, reads anything else as missing, and records what was asked", async () => {
  const library = createInMemoryLibraryItems(config, {
    "item-1": { name: "SOP.pdf", kind: "file", mime_type: "application/pdf", etag: "e1", web_url: "https://mvtamn.sharepoint.com/SOP.pdf" },
    "item-2": { outcome: "failed", reason: "down" },
  });
  const found = await library.readItem("item-1");
  assert.equal(found.outcome === "ok" && found.item.site_id, config.site_id);
  assert.deepEqual(await library.readItem("item-2"), { outcome: "failed", reason: "down" });
  assert.equal((await library.readItem("item-9")).outcome, "not_found");
  assert.deepEqual(library.reads, ["item-1", "item-2", "item-9"]);
});
