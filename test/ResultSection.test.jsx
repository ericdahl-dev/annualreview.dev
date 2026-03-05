/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ResultSection from "../src/ResultSection.tsx";

describe("ResultSection", () => {
  it("renders title and pretty-printed JSON", () => {
    const data = { key: "value" };
    render(<ResultSection title="Themes" data={data} />);
    expect(screen.getByRole("heading", { name: "Themes" })).toBeInTheDocument();
    expect(screen.getByText(/"key": "value"/)).toBeInTheDocument();
  });

  it("copies text to clipboard when Copy is clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const data = { a: 1 };
    render(<ResultSection title="Bullets" data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });
});
