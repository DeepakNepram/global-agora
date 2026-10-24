import {
  breadcrumbsIntegration,
  browserApiErrorsIntegration,
  captureException,
  captureMessage,
  dedupeIntegration,
  eventFiltersIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  httpContextIntegration,
  init,
  linkedErrorsIntegration,
  type Breadcrumb,
  type ErrorEvent as SentryEvent,
} from '@sentry/browser';

// Direct, not through the barrel: only this lazy chunk needs it.
import { scrubUrlValue, withoutQuery } from '@/core/scrub';

import type { ErrorReporter, ErrorReportingConfig } from './errorReporting';

/**
 * Sentry, loaded after the start by ./errorReporting.ts. Errors only: no
 * tracing, no session replay, no release-health sessions, no user, no IP.
 * What it sends is scrubbed of every URL's query and fragment
 * (src/core/scrub.ts), and of the Referer and cookies, here as well as by the
 * SDK's own settings; DOM click breadcrumbs are off, since a button's label
 * can name a post's author.
 */

function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const { data } = crumb;
  if (!data) return crumb;
  return {
    ...crumb,
    data: {
      ...data,
      url: scrubUrlValue(data['url']),
      from: scrubUrlValue(data['from']),
      to: scrubUrlValue(data['to']),
    },
  };
}

function scrubEvent(event: SentryEvent): SentryEvent {
  const request = event.request;
  if (request) {
    const headers = { ...request.headers };
    delete headers['Referer'];
    delete headers['referer'];
    event.request = {
      ...request,
      ...(request.url === undefined ? {} : { url: withoutQuery(request.url) }),
      headers,
    };
    delete event.request.query_string;
    delete event.request.cookies;
  }
  delete event.user;
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

export function startSentry(
  config: ErrorReportingConfig & { readonly dsn: string },
): ErrorReporter {
  init({
    dsn: config.dsn,
    release: config.release,
    environment: config.environment,
    // No user fields, so Sentry's server is told never to infer an IP
    // address; no cookies, bodies or query strings; of the headers, only the
    // browser's name.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
    },
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      functionToStringIntegration(),
      browserApiErrorsIntegration(),
      breadcrumbsIntegration({ dom: false }),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      httpContextIntegration(),
    ],
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
  return {
    error: (error, context) => {
      captureException(error, context ? { extra: context } : undefined);
    },
    warning: (message, context, group) => {
      captureMessage(message, {
        level: 'warning',
        ...(context ? { extra: context } : {}),
        ...(group ? { fingerprint: [group] } : {}),
      });
    },
  };
}
