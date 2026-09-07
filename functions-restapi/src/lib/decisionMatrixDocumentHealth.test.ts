import assert from "node:assert/strict";
import test from "node:test";
import { createGraphDocumentChecker } from "./decisionMatrixDocumentHealth";

const reference = {
  site_id: "site-1", drive_id: "drive-1", item_id: "item-1",
  expected_version: "v3", expected_file_name: "SOP.docx",
  expected_mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

test("a matching SharePoint document is Valid", async () => {
  const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response(JSON.stringify({
    eTag: "v3", name: "SOP.docx", file: { mimeType: reference.expected_mime_type },
  }), { status: 200 }));

  const result = await checker(reference, "user-assertion");
  assert.deepEqual(result, { health_status: "Valid", observed_version: "v3", observed_file_name: "SOP.docx", observed_mime_type: reference.expected_mime_type, reason: null });
});

test("a changed SharePoint document Needs review without becoming unavailable", async () => {
  const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response(JSON.stringify({
    eTag: "v4", name: "SOP.docx", file: { mimeType: reference.expected_mime_type },
  }), { status: 200 }));

  const result = await checker(reference, "user-assertion");
  assert.equal(result.health_status, "Needs review");
  assert.equal(result.reason, "The SharePoint document metadata no longer matches this Procedure Revision.");
});

// 401, 403 and 404 all mean the document could not be inspected, so all three
// stay Unavailable. They do not mean the same thing to whoever reads the
// result, and the reason is the only place that distinction can live.
test("a library OnBoard was never granted is reported as a permissions gap, not a document problem", async () => {
  const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response("", { status: 403 }));

  const result = await checker(reference, "user-assertion");
  assert.equal(result.health_status, "Unavailable");
  assert.match(result.reason ?? "", /not authorized to read this SharePoint library/);
  assert.match(result.reason ?? "", /not a problem with the document/);
});

test("a credential SharePoint rejects is reported as configuration, not as a document problem", async () => {
  const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response("", { status: 401 }));

  const result = await checker(reference, "user-assertion");
  assert.equal(result.health_status, "Unavailable");
  assert.match(result.reason ?? "", /rejected OnBoard's credential/);
  assert.match(result.reason ?? "", /not a problem with the document/);
});

test("a document that is genuinely not there says so, and says nothing about permissions", async () => {
  const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response("", { status: 404 }));

  const result = await checker(reference, "user-assertion");
  assert.equal(result.health_status, "Unavailable");
  assert.match(result.reason ?? "", /no document at the site, drive and item/);
  assert.doesNotMatch(result.reason ?? "", /authorized|credential|permission/);
});

test("the three failures do not share a message", async () => {
  const reasons = await Promise.all([401, 403, 404].map(async (status) => {
    const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response("", { status }));
    return (await checker(reference, "user-assertion")).reason;
  }));
  assert.equal(new Set(reasons).size, 3, `expected three distinct reasons, got ${JSON.stringify(reasons)}`);
});
