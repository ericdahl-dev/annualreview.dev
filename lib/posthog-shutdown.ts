/**
 * SIGTERM/SIGINT: flush PostHog OTLP logs before exit. Extracted for unit tests.
 */
import { logger, shutdownPostHogLogs } from "./posthog-logs.ts";

const DEFAULT_FLUSH_MS = 10_000;

export interface PosthogShutdownDeps {
  shutdownLogs: () => Promise<void>;
  exit: (code: number) => void;
  onConsoleError: (...args: unknown[]) => void;
  flushTimeoutMs: number;
  loggerEmitError: (signal: NodeJS.Signals, err: unknown) => void;
}

export function createPosthogShutdownHandler(deps: PosthogShutdownDeps) {
  let shuttingDown = false;
  return function handleShutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) return;
    shuttingDown = true;

    const timeout = setTimeout(() => {
      deps.onConsoleError(
        `[shutdown] Timed out waiting for PostHog logs to flush after ${signal}; exiting with code 1.`
      );
      deps.exit(1);
    }, deps.flushTimeoutMs);

    deps
      .shutdownLogs()
      .then(() => {
        clearTimeout(timeout);
        deps.exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        deps.onConsoleError(
          `[shutdown] Failed to flush PostHog logs on ${signal}:`,
          err
        );
        try {
          deps.loggerEmitError(signal, err);
        } catch {
          // If logging fails here, we still proceed with non-zero exit.
        }
        deps.exit(1);
      });
  };
}

export function attachPosthogLogShutdown(): void {
  const handler = createPosthogShutdownHandler({
    shutdownLogs: shutdownPostHogLogs,
    exit: (c) => process.exit(c),
    onConsoleError: (...args) => console.error(...args),
    flushTimeoutMs: DEFAULT_FLUSH_MS,
    loggerEmitError: (signal, err) => {
      logger.emit({
        severityText: "ERROR",
        body: "Failed to flush PostHog logs during shutdown",
        attributes: { signal, error: String(err) },
      });
    },
  });
  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
}
