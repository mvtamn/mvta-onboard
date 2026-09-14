import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisibleInterval } from "./useVisibleInterval.js";

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useVisibleInterval", () => {
  it("calls back on the interval while the page is visible", () => {
    const callback = vi.fn();
    renderHook(() => useVisibleInterval(callback, 60_000));
    vi.advanceTimersByTime(59_999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  // A background tab must not keep polling the shared REST app.
  it("does not poll while the page is hidden", () => {
    const callback = vi.fn();
    renderHook(() => useVisibleInterval(callback, 60_000));
    visibility = "hidden";
    vi.advanceTimersByTime(180_000);
    expect(callback).not.toHaveBeenCalled();
  });

  it("refreshes at once when a hidden page becomes visible again", () => {
    const callback = vi.fn();
    renderHook(() => useVisibleInterval(callback, 60_000));
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).not.toHaveBeenCalled();
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the component unmounts", () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => useVisibleInterval(callback, 60_000));
    unmount();
    vi.advanceTimersByTime(180_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).not.toHaveBeenCalled();
  });
});
