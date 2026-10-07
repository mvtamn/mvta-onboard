import { describe, expect, it } from "vitest";
import { filesFromTransfer } from "./pastedFiles";

function transfer(files: File[]): DataTransfer {
  return { files } as unknown as DataTransfer;
}

const NOW = new Date(2026, 9, 7, 14, 5, 9);

describe("filesFromTransfer", () => {
  it("is empty when there is nothing on the clipboard", () => {
    expect(filesFromTransfer(null)).toEqual([]);
    expect(filesFromTransfer(transfer([]))).toEqual([]);
  });

  it("gives a pasted screenshot a timestamped name and keeps its type", () => {
    const [file] = filesFromTransfer(transfer([new File(["x"], "image.png", { type: "image/png" })]), NOW);
    expect(file.name).toBe("pasted-20261007-140509.png");
    expect(file.type).toBe("image/png");
  });

  it("numbers several generic pastes so they stay distinct", () => {
    const files = filesFromTransfer(transfer([
      new File(["a"], "image.png", { type: "image/png" }),
      new File(["b"], "image.png", { type: "image/png" }),
    ]), NOW);
    expect(files.map((f) => f.name)).toEqual(["pasted-20261007-140509-1.png", "pasted-20261007-140509-2.png"]);
  });

  it("leaves a real file name alone", () => {
    const original = new File(["x"], "Wescott detour map.pdf", { type: "application/pdf" });
    expect(filesFromTransfer(transfer([original]), NOW)[0]).toBe(original);
  });
});
