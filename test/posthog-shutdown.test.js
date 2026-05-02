import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPosthogShutdownHandler } from "../lib/posthog-shutdown.ts";

describe("createPosthogShutdownHandler", () => {
  let exit;
  let shutdownLogs;
  let onConsoleError;
  let loggerEmitError;

  beforeEach(() => {
    exit = vi.fn();
    shutdownLogs = vi.fn();
    onConsoleError = vi.fn();
    loggerEmitError = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exits 0 when flush succeeds", async () => {
    shutdownLogs.mockResolvedValue(undefined);
    const handle = createPosthogShutdownHandler({
      shutdownLogs,
      exit,
      onConsoleError,
      flushTimeoutMs: 10_000,
      loggerEmitError,
    });
    handle("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(shutdownLogs).toHaveBeenCalledOnce();
  });

  it("exits 1 and logs when flush rejects", async () => {
    const err = new Error("flush failed");
    shutdownLogs.mockRejectedValue(err);
    const handle = createPosthogShutdownHandler({
      shutdownLogs,
      exit,
      onConsoleError,
      flushTimeoutMs: 10_000,
      loggerEmitError,
    });
    handle("SIGINT");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(onConsoleError).toHaveBeenCalled();
    expect(loggerEmitError).toHaveBeenCalledWith("SIGINT", err);
  });

  it("ignores second signal (idempotent)", async () => {
    shutdownLogs.mockImplementation(
      () => new Promise((r) => setTimeout(r, 99_000))
    );
    const handle = createPosthogShutdownHandler({
      shutdownLogs,
      exit,
      onConsoleError,
      flushTimeoutMs: 10_000,
      loggerEmitError,
    });
    handle("SIGTERM");
    handle("SIGTERM");
    expect(shutdownLogs).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when flush hangs past timeout", async () => {
    vi.useFakeTimers();
    shutdownLogs.mockImplementation(() => new Promise(() => {}));
    const handle = createPosthogShutdownHandler({
      shutdownLogs,
      exit,
      onConsoleError,
      flushTimeoutMs: 10_000,
      loggerEmitError,
    });
    handle("SIGTERM");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit).toHaveBeenCalledWith(1);
    expect(onConsoleError).toHaveBeenCalledWith(
      expect.stringMatching(/Timed out waiting for PostHog logs/)
    );
  });

  it("continues to exit 1 when loggerEmitError throws", async () => {
    const err = new Error("flush failed");
    shutdownLogs.mockRejectedValue(err);
    loggerEmitError.mockImplementation(() => {
      throw new Error("logger boom");
    });
    const handle = createPosthogShutdownHandler({
      shutdownLogs,
      exit,
      onConsoleError,
      flushTimeoutMs: 10_000,
      loggerEmitError,
    });
    handle("SIGTERM");
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
