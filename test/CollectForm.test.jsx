/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollectForm, { CollectDateRange } from "../src/CollectForm.tsx";

describe("CollectDateRange", () => {
  it("renders From and To date inputs", () => {
    render(
      <CollectDateRange
        startDate="2025-01-01"
        endDate="2025-12-31"
        onStartChange={() => {}}
        onEndChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/from/i)).toHaveValue("2025-01-01");
    expect(screen.getByLabelText(/to/i)).toHaveValue("2025-12-31");
  });

  it("calls onStartChange and onEndChange", () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    render(
      <CollectDateRange
        startDate="2025-01-01"
        endDate="2025-12-31"
        onStartChange={onStart}
        onEndChange={onEnd}
      />,
    );
    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: "2025-06-01" } });
    expect(onStart).toHaveBeenCalledWith("2025-06-01");
    fireEvent.change(screen.getByLabelText(/to/i), { target: { value: "2025-06-30" } });
    expect(onEnd).toHaveBeenCalledWith("2025-06-30");
  });
});

describe("CollectForm", () => {
  const baseProps = {
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    onStartChange: vi.fn(),
    onEndChange: vi.fn(),
    error: null,
    progress: "",
    loading: false,
    onSubmit: vi.fn(),
  };

  it("renders submit button with default label", () => {
    render(<CollectForm {...baseProps} />);
    expect(screen.getByRole("button", { name: /fetch my data/i })).toBeInTheDocument();
  });

  it("renders custom submitLabel", () => {
    render(<CollectForm {...baseProps} submitLabel="Go" />);
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("shows error when error prop is set", () => {
    render(<CollectForm {...baseProps} error="Something went wrong" />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows progress text", () => {
    render(<CollectForm {...baseProps} progress="Fetching PRs..." />);
    expect(screen.getByText("Fetching PRs...")).toBeInTheDocument();
  });

  it("disables button when loading", () => {
    render(<CollectForm {...baseProps} loading={true} />);
    const btn = screen.getByRole("button", { name: /fetching/i });
    expect(btn).toBeDisabled();
  });

  it("calls onSubmit when button clicked", () => {
    const onSubmit = vi.fn();
    render(<CollectForm {...baseProps} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: /fetch my data/i }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("renders children", () => {
    render(
      <CollectForm {...baseProps}>
        <input placeholder="token" />
      </CollectForm>,
    );
    expect(screen.getByPlaceholderText("token")).toBeInTheDocument();
  });
});
