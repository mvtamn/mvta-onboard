import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@mvta/shared";
import type { DecisionMatrixLibraryEntry, DecisionMatrixLibraryDiagnostics } from "@mvta/shared";
import { DocumentPicker, missingFacts } from "./DocumentPicker.js";

vi.mock("../config.js", () => ({ api: { getDecisionMatrixLibrary: vi.fn() } }));
import { api } from "../config.js";

const SITE = "mvtamn.sharepoint.com,aaa,bbb";
const DRIVE = "drive-1";

function ok(entries: DecisionMatrixLibraryEntry[], path = ""): { entries: DecisionMatrixLibraryEntry[]; diagnostics: DecisionMatrixLibraryDiagnostics } {
  return {
    entries,
    diagnostics: {
      configured: true, outcome: "ok", path, reason: null, site_id: SITE, drive_id: DRIVE,
      folder_count: entries.filter((e) => e.kind === "folder").length,
      file_count: entries.filter((e) => e.kind === "file").length,
    },
  };
}

const folder = (name: string, path: string, childCount = 3): DecisionMatrixLibraryEntry => ({
  item_id: `id-${name}`, name, kind: "folder", path, mime_type: null, size_bytes: null,
  etag: null, last_modified_at: null, child_count: childCount, web_url: null,
});

const file = (name: string, path: string, overrides: Partial<DecisionMatrixLibraryEntry> = {}): DecisionMatrixLibraryEntry => ({
  item_id: `id-${name}`, name, kind: "file", path, mime_type: "application/pdf", size_bytes: 2048,
  etag: `"etag-${name}"`, last_modified_at: "2026-09-01T00:00:00Z", child_count: null,
  web_url: `https://mvtamn.sharepoint.com/${name}`, ...overrides,
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => cleanup());

describe("Document picker", () => {
  it("lists the library and descends into a folder", async () => {
    vi.mocked(api.getDecisionMatrixLibrary)
      .mockResolvedValueOnce(ok([folder("_SOPs", "_SOPs"), file("Loose.pdf", "Loose.pdf")]))
      .mockResolvedValueOnce(ok([file("SOP-1.pdf", "_SOPs/SOP-1.pdf")], "_SOPs"));
    render(<DocumentPicker onChoose={() => undefined} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /_SOPs/ }));
    expect(await screen.findByText("SOP-1.pdf")).toBeInTheDocument();
    expect(vi.mocked(api.getDecisionMatrixLibrary)).toHaveBeenLastCalledWith("_SOPs");
  });

  it("hands back everything a document reference needs, so nothing is typed by hand", async () => {
    vi.mocked(api.getDecisionMatrixLibrary).mockResolvedValue(ok([file("SOP-1.pdf", "_SOPs/SOP-1.pdf")], "_SOPs"));
    const chosen = vi.fn();
    render(<DocumentPicker onChoose={chosen} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /SOP-1\.pdf/ }));
    expect(chosen).toHaveBeenCalledWith({
      site_id: SITE,
      drive_id: DRIVE,
      item_id: "id-SOP-1.pdf",
      expected_version: '"etag-SOP-1.pdf"',
      expected_file_name: "SOP-1.pdf",
      expected_mime_type: "application/pdf",
      web_url: "https://mvtamn.sharepoint.com/SOP-1.pdf",
      path: "_SOPs/SOP-1.pdf",
    });
  });

  // A reference saved with an empty expected version fails its first health
  // check, and the failure reads as the document having changed.
  it("refuses a file SharePoint did not fully describe, and says what is missing", async () => {
    vi.mocked(api.getDecisionMatrixLibrary).mockResolvedValue(ok([file("NoTag.pdf", "NoTag.pdf", { etag: null })]));
    const chosen = vi.fn();
    render(<DocumentPicker onChoose={chosen} />);
    const button = await screen.findByRole("button", { name: /NoTag\.pdf/ });
    expect(button).toBeDisabled();
    expect(screen.getByText(/did not report a version/)).toBeInTheDocument();
    await userEvent.setup().click(button).catch(() => undefined);
    expect(chosen).not.toHaveBeenCalled();
  });

  it("will not choose a document when the server did not say which library it read", () => {
    const entry = file("SOP-1.pdf", "SOP-1.pdf");
    const withoutLibrary = { configured: true, outcome: "ok", path: "", reason: null } as DecisionMatrixLibraryDiagnostics;
    expect(missingFacts(entry, withoutLibrary)).toContain("which library it is in");
    expect(missingFacts(entry, { ...withoutLibrary, site_id: SITE, drive_id: DRIVE })).toEqual([]);
  });

  it("tells apart the ways a library can be unreadable", async () => {
    const cases = [
      ["not_configured", /No approved library is configured/],
      ["forbidden", /OnBoard cannot read this library/],
      ["not_found", /That folder is not there/],
      ["failed", /The library could not be read/],
    ] as const;
    for (const [outcome, heading] of cases) {
      vi.mocked(api.getDecisionMatrixLibrary).mockResolvedValue({
        entries: [],
        diagnostics: { configured: outcome !== "not_configured", outcome, path: "", reason: "Because." },
      });
      render(<DocumentPicker onChoose={() => undefined} />);
      expect(await screen.findByText(heading)).toBeInTheDocument();
      cleanup();
    }
  });

  it("calls an expired sign-in an expired sign-in, not a SharePoint problem", async () => {
    vi.mocked(api.getDecisionMatrixLibrary).mockRejectedValue(new ApiError(401, "Not authenticated."));
    render(<DocumentPicker onChoose={() => undefined} />);
    expect(await screen.findByText("Your sign-in has expired.", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Reload the page to sign in again.");
    expect(screen.queryByText(/cannot read this library/)).not.toBeInTheDocument();
  });

  it("says an empty folder is empty rather than showing nothing", async () => {
    vi.mocked(api.getDecisionMatrixLibrary).mockResolvedValue(ok([], "_SOPs/_Drafts"));
    render(<DocumentPicker onChoose={() => undefined} />);
    expect(await screen.findByText("This folder is empty.")).toBeInTheDocument();
  });

  it("offers a way back up from a deep folder", async () => {
    vi.mocked(api.getDecisionMatrixLibrary)
      .mockResolvedValueOnce(ok([folder("_OCC Documents", "_SOPs/_OCC Documents")], "_SOPs"))
      .mockResolvedValueOnce(ok([file("SOP-1.pdf", "_SOPs/_OCC Documents/SOP-1.pdf")], "_SOPs/_OCC Documents"))
      .mockResolvedValueOnce(ok([folder("_SOPs", "_SOPs")], ""));
    render(<DocumentPicker onChoose={() => undefined} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /_OCC Documents/ }));
    await screen.findByText("SOP-1.pdf");
    await user.click(screen.getByRole("button", { name: "Library" }));
    expect(vi.mocked(api.getDecisionMatrixLibrary)).toHaveBeenLastCalledWith(undefined);
  });
});
