import assert from "node:assert/strict";
import test from "node:test";
import { createSharePointLibrary, normalizeLibraryPath, InvalidLibraryPathError } from "./sharepointLibrary";

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
  assert.match(listing.reason, /not been granted/);
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

test("the four outcomes do not share a message", async () => {
  const reasons = new Set<string>();
  for (const status of [403, 404, 503]) {
    const { fetchGraph } = graphReturning([{ status }]);
    const listing = await createSharePointLibrary(config, async () => "token", fetchGraph).listFolder("_SOPs");
    if (listing.outcome !== "ok") reasons.add(listing.reason);
  }
  assert.equal(reasons.size, 3, `expected three distinct reasons, got ${JSON.stringify([...reasons])}`);
});
