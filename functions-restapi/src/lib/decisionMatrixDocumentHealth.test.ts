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

test("a missing or forbidden SharePoint document is Unavailable", async () => {
  const checker = createGraphDocumentChecker(async () => "delegated-token", async () => new Response("", { status: 403 }));

  const result = await checker(reference, "user-assertion");
  assert.deepEqual(result, { health_status: "Unavailable", observed_version: null, observed_file_name: null, observed_mime_type: null, reason: "SharePoint did not make the document available to this Admin." });
});
