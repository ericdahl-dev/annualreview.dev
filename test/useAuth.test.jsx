/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const posthogStub = vi.hoisted(() => ({
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../src/posthog.ts", () => ({ posthog: posthogStub }));

import { useAuth } from "../src/hooks/useAuth.ts";

function Harness() {
  const { user, authChecked, logout } = useAuth();
  if (!authChecked) return <div>checking</div>;
  return (
    <div>
      <span data-testid="user">{user ? user.login : "none"}</span>
      <button type="button" onClick={logout}>
        log out
      </button>
    </div>
  );
}

function mockRes(body, ok = true, status = ok ? 200 : 401) {
  const str = typeof body === "string" ? body : JSON.stringify(body);
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  return {
    ok,
    status,
    json: () => Promise.resolve(parsed),
  };
}

describe("useAuth", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    posthogStub.identify.mockClear();
    posthogStub.reset.mockClear();
  });

  it("calls posthog.identify with login when /api/auth/me succeeds", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockRes({ login: "octocat", scope: "read:user" })
    );
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("octocat"));
    expect(posthogStub.identify).toHaveBeenCalledWith("octocat");
    expect(posthogStub.reset).not.toHaveBeenCalled();
  });

  it("calls posthog.reset after logout succeeds", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRes({ login: "octocat", scope: "read:user" }))
      .mockResolvedValueOnce(mockRes({ ok: true }));
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("octocat"));
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(posthogStub.reset).toHaveBeenCalled();
  });
});
