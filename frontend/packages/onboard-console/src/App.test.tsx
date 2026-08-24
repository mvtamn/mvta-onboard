import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth/AuthContext.js", () => ({ useAuth: vi.fn() }));
vi.mock("./routes/AdminModules.js", () => ({}));
vi.mock("./routes/modules/EventMonitoring.js", () => ({}));
vi.mock("./hooks/useLiveStats.js", () => ({
  useLiveStats: vi.fn(),
  dataStateLabel: vi.fn(() => "Loading live data"),
}));
vi.mock("./theme/ThemeContext.js", () => ({
  useTheme: vi.fn(() => ({ theme: "light", toggle: vi.fn() })),
}));

const { useAuth } = await import("./auth/AuthContext.js");
const { useLiveStats } = await import("./hooks/useLiveStats.js");
const { App } = await import("./App.js");

describe("App authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      account: null,
      roles: [],
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it("does not start API-backed shell data while authentication is unavailable", () => {
    render(<MemoryRouter><App /></MemoryRouter>);

    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeInTheDocument();
    expect(useLiveStats).not.toHaveBeenCalled();
  });
});
