/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../src/posthog.ts", () => ({
  posthog: { capture: vi.fn() },
}));

vi.mock("../src/Generate.tsx", () => ({
  default: () => <div data-testid="generate-page">Generate</div>,
}));

vi.mock("../src/Landing.tsx", () => ({
  default: () => <div data-testid="landing-page">Landing</div>,
}));

import App from "../src/App.tsx";
import { posthog } from "../src/posthog.ts";

describe("App", () => {
  let origPathname;

  beforeEach(() => {
    origPathname = window.location.pathname;
    vi.mocked(posthog.capture).mockClear();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: origPathname },
      writable: true,
    });
  });

  it("renders Landing when path is /", () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/" },
      writable: true,
    });
    render(<App />);
    expect(screen.getByTestId("landing-page")).toBeInTheDocument();
  });

  it("renders Generate when path is /generate", () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/generate" },
      writable: true,
    });
    render(<App />);
    expect(screen.getByTestId("generate-page")).toBeInTheDocument();
  });

  it("captures $pageview on mount", () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/" },
      writable: true,
    });
    render(<App />);
    expect(posthog.capture).toHaveBeenCalledWith("$pageview", { path: "/" });
  });
});
