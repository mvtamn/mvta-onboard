import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement scrollIntoView (used by EventWorkspaceNav to bring
// the active stage into view on mobile) - stub it so components that call it
// don't crash under test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
