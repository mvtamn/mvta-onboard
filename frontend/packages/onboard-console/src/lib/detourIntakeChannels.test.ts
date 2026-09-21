import { describe, expect, it } from "vitest";
import type { DetourChannelOption } from "@mvta/shared";
import { channelChips, hasUsableChannel, retiredHint, toggleChannel } from "./detourIntakeChannels.js";

const AVAILABLE: DetourChannelOption[] = [
  { channel: "email", label: "Email", kind: "sent", needs_recipients: true },
  { channel: "sms", label: "Text message", kind: "sent", needs_recipients: true },
  { channel: "digital_signage", label: "Digital signage", kind: "recorded", needs_recipients: false },
];

describe("the channels intake offers", () => {
  it("offers exactly what the server says a communication can use", () => {
    const chips = channelChips(AVAILABLE, []);
    expect(chips.map((c) => c.channel)).toEqual(["email", "sms", "digital_signage"]);
    expect(chips.every((c) => !c.selected)).toBe(true);
    expect(chips.some((c) => c.channel === "radio")).toBe(false);
  });

  it("marks what this record already requires", () => {
    const chips = channelChips(AVAILABLE, ["sms"]);
    expect(chips.find((c) => c.channel === "sms")?.selected).toBe(true);
    expect(chips.find((c) => c.channel === "email")?.selected).toBe(false);
  });

  it("matches a stored value however it was cased", () => {
    expect(channelChips(AVAILABLE, [" EMAIL "]).find((c) => c.channel === "email")?.selected).toBe(true);
  });

  it("keeps a channel the record names that is no longer offered", () => {
    const chips = channelChips(AVAILABLE, ["email", "radio"]);
    const retired = chips.find((c) => c.channel === "radio");
    expect(retired).toMatchObject({ selected: true, retired: true, kind: "retired" });
    expect(retiredHint("radio")).toContain("no longer");
  });

  it("lets a retired channel be removed but never added back", () => {
    const chips = channelChips(AVAILABLE, ["radio"]);
    const radio = chips.find((c) => c.channel === "radio")!;
    expect(toggleChannel(["radio"], radio)).toEqual([]);
    expect(toggleChannel([], { ...radio, selected: false })).toEqual([]);
  });

  it("adds and removes an offered channel", () => {
    const chips = channelChips(AVAILABLE, []);
    const email = chips.find((c) => c.channel === "email")!;
    expect(toggleChannel([], email)).toEqual(["email"]);
    expect(toggleChannel(["email"], { ...email, selected: true })).toEqual([]);
  });

  it("a record requiring only a retired channel has nothing usable", () => {
    expect(hasUsableChannel(channelChips(AVAILABLE, ["radio"]))).toBe(false);
    expect(hasUsableChannel(channelChips(AVAILABLE, ["radio", "email"]))).toBe(true);
    expect(hasUsableChannel(channelChips(AVAILABLE, []))).toBe(false);
  });
});
