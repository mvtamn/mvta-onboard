import { describe, expect, it } from "vitest";
import { ApiError } from "@mvta/shared";
import { apiErrorText } from "./apiErrorText.js";

describe("apiErrorText", () => {
  it("names the fields at fault instead of only 'Validation failed'", () => {
    const err = new ApiError(400, "Validation failed", ["closure is required and must be a non-empty string", "end_date must be on or after start_date"]);
    expect(apiErrorText(err, "Save failed.")).toBe("Validation failed: closure is required and must be a non-empty string; end_date must be on or after start_date");
  });

  it("reads details given as { message } objects", () => {
    expect(apiErrorText(new ApiError(400, "Validation failed", [{ field: "x", message: "x is wrong" }]), "Save failed.")).toBe("Validation failed: x is wrong");
  });

  it("shows the server sentence alone when there are no details", () => {
    expect(apiErrorText(new ApiError(409, "This Detour is closed."), "Save failed.")).toBe("This Detour is closed.");
    expect(apiErrorText(new ApiError(400, "Validation failed", { document_check: {} }), "Save failed.")).toBe("Validation failed");
  });

  it("falls back for anything that is not an API error", () => {
    expect(apiErrorText(new Error("Network down"), "Save failed.")).toBe("Network down");
    expect(apiErrorText("boom", "Save failed.")).toBe("Save failed.");
  });
});
