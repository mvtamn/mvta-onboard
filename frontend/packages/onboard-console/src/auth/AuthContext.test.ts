import { InteractionStatus, type AccountInfo } from "@azure/msal-browser";
import { describe, expect, it } from "vitest";
import { accountAfterInteraction } from "./AuthContext.js";

const account = { username: "operator@mvta.com" } as AccountInfo;

describe("accountAfterInteraction", () => {
  it("does not expose a cached account while MSAL is still initializing", () => {
    expect(accountAfterInteraction([account], InteractionStatus.Startup)).toBeNull();
    expect(accountAfterInteraction([account], InteractionStatus.HandleRedirect)).toBeNull();
    expect(accountAfterInteraction([account], InteractionStatus.None)).toBe(account);
  });
});
