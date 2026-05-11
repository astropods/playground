import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";

function Bomb({ when }: { when: boolean }) {
  if (when) throw new Error("kaboom");
  return <div>safe</div>;
}

beforeEach(() => {
  // React logs the caught error to console.error — silence to keep test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <Bomb when={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("safe")).toBeInTheDocument();
  });

  it("renders fallback when a child throws", () => {
    render(
      <ErrorBoundary>
        <Bomb when={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload/i })).toBeInTheDocument();
  });

  it("reload button calls window.location.reload", async () => {
    const user = userEvent.setup();
    // jsdom location.reload is a real method; stub it.
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <ErrorBoundary>
        <Bomb when={true} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByRole("button", { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
  });
});
