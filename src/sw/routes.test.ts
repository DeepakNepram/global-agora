import { describe, expect, it } from 'vitest';

import { precacheUrl, routeFor, shellCacheName, type RouteRequest } from './routes';

const ORIGIN = 'https://agora.example';
const PRECACHED = new Set(['/', '/assets/index-abc.js', '/assets/index-def.css']);

function get(path: string, mode = 'cors'): RouteRequest {
  return { method: 'GET', url: new URL(path, ORIGIN).href, mode };
}

const kind = (request: RouteRequest): string => routeFor(request, ORIGIN, PRECACHED).kind;

describe('service worker routes', () => {
  it('serves page navigations network first, on any path', () => {
    expect(kind(get('/', 'navigate'))).toBe('shell');
    expect(kind(get('/privacy', 'navigate'))).toBe('shell');
    expect(kind(get('/?story=12&lat=1', 'navigate'))).toBe('shell');
  });

  it('serves the precached shell from the cache', () => {
    expect(kind(get('/assets/index-abc.js'))).toBe('precached');
    expect(kind(get('/assets/index-def.css'))).toBe('precached');
  });

  it('keeps other build files once fetched', () => {
    expect(kind(get('/assets/AdminApp-123.js'))).toBe('immutable');
    expect(kind(get('/assets/db-456.js'))).toBe('immutable');
  });

  it('revalidates textures, data and icons in the background', () => {
    expect(kind(get('/textures/day-2048.webp'))).toBe('static');
    expect(kind(get('/data/places.v1.json'))).toBe('static');
    expect(kind(get('/icons/icon-192.png'))).toBe('static');
    expect(kind(get('/favicon.svg'))).toBe('static');
    expect(kind(get('/manifest.webmanifest'))).toBe('static');
  });

  it('leaves alone what it must not answer', () => {
    expect(kind({ ...get('/api/report'), method: 'POST' })).toBe('pass');
    expect(kind(get('https://ref.supabase.co/rest/v1/profiles'))).toBe('pass');
    expect(kind(get('https://o1.ingest.sentry.io/api/1/envelope/'))).toBe('pass');
    expect(kind(get('/sw.js'))).toBe('pass');
    expect(kind(get('/__bench'))).toBe('pass');
  });

  it('names the page "/" and versions the shell cache', () => {
    expect(precacheUrl('index.html')).toBe('/');
    expect(precacheUrl('assets/index-abc.js')).toBe('/assets/index-abc.js');
    expect(shellCacheName('0123abcd')).toBe('agora-shell-0123abcd');
  });
});
