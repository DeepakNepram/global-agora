import { afterStart } from './afterStart';

/**
 * Error reporting (Prompt 5.2): a few hundred bytes in the start, so errors
 * are caught from the first line, and Sentry's SDK (./sentry.ts, its own
 * chunk) only once the page has started. Until then what is caught waits in
 * a short buffer; Sentry's own handlers take over when it arrives.
 *
 * Without a DSN (development, the browser checks, a build without one)
 * nothing loads and nothing is sent.
 */

/** Extra facts for a report: short strings, nothing about the reader. */
export type ErrorContext = Readonly<Record<string, string>>;

export interface ErrorReporter {
  error(error: unknown, context?: ErrorContext): void;
  /** `group` puts every warning of a kind under one issue, whatever its message says. */
  warning(message: string, context?: ErrorContext, group?: string): void;
}

export interface ErrorReportingConfig {
  /** VITE_SENTRY_DSN, public by design; null turns reporting off. */
  readonly dsn: string | null;
  /** The git commit the build came from, matching its uploaded source maps. */
  readonly release: string;
  readonly environment: string;
}

/** A page that throws in a loop must not queue without end. */
const MAX_WAITING = 20;

let reporter: ErrorReporter | null = null;
let enabled = false;
const waiting: ((to: ErrorReporter) => void)[] = [];

function send(job: (to: ErrorReporter) => void): void {
  if (reporter) job(reporter);
  else if (enabled && waiting.length < MAX_WAITING) waiting.push(job);
}

export function reportError(error: unknown, context?: ErrorContext): void {
  send((to) => to.error(error, context));
}

/**
 * Something survivable that we want counted, such as a lost WebGL context.
 * Give repeats different messages (Sentry drops an event identical to the
 * one before it) and the same `group`.
 */
export function reportWarning(message: string, context?: ErrorContext, group?: string): void {
  send((to) => to.warning(message, context, group));
}

export function startErrorReporting(config: ErrorReportingConfig): void {
  const { dsn } = config;
  if (dsn === null || enabled) return;
  enabled = true;
  const onError = (event: ErrorEvent): void => reportError(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent): void => reportError(event.reason);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  afterStart(() => {
    import('./sentry').then(
      ({ startSentry }) => {
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
        const started = startSentry({ ...config, dsn });
        reporter = started;
        for (const job of waiting.splice(0)) job(started);
      },
      (error: unknown) => console.warn('Error reporting could not load.', error),
    );
  });
}
