import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { build, type Plugin } from 'vite';

/**
 * Builds the service worker (src/sw/sw.ts) into dist/sw.js once the app's
 * own build is written (Prompt 5.2), with this build's shell list and a
 * version hash compiled in.
 *
 * A separate build on purpose: the worker must be one classic script, and
 * as an entry of the app's build it would share chunks with the page.
 * Hand-written rather than Workbox (vite-plugin-pwa): the worker is about a
 * hundred lines, and the plugin's dependency tree is not tested on rolldown.
 */

/**
 * Chunks a reader's start never needs, so not precached; each is still kept
 * after its first use (src/sw/routes.ts, `immutable`). By chunk name, which
 * rolldown takes from the dynamically imported module's file name.
 */
const NOT_PRECACHED = new Set(['AdminApp', 'admin', 'db', 'GlobeDevTools', 'sentry']);

export function serviceWorker(): Plugin {
  let root = '.';
  let outDir = 'dist';
  let apiBase = '/api';
  let precache: string[] = [];

  return {
    name: 'agora:service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
      // The same fallback as src/core/config.ts's FREE_TIER_DEFAULTS.apiBaseUrl.
      apiBase = config.env['VITE_API_BASE_URL']?.trim() || '/api';
    },
    // writeBundle, not generateBundle: index.html is only in the bundle by then.
    writeBundle(_options, bundle) {
      precache = Object.values(bundle)
        .filter((file) => !file.fileName.endsWith('.map'))
        .filter((file) => file.type === 'asset' || !NOT_PRECACHED.has(file.name))
        .map((file) => file.fileName)
        .sort();
    },
    async closeBundle() {
      // File names carry content hashes, except index.html, which changes
      // whenever they do: hashing the list versions the whole shell.
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      await build({
        configFile: false,
        logLevel: 'warn',
        publicDir: false,
        define: {
          __AGORA_PRECACHE__: JSON.stringify(precache),
          __AGORA_VERSION__: JSON.stringify(version),
          __AGORA_API_BASE__: JSON.stringify(apiBase),
        },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          sourcemap: false,
          target: 'es2022',
          lib: {
            entry: resolve(root, 'src', 'sw', 'sw.ts'),
            formats: ['iife'],
            name: 'agoraServiceWorker',
            fileName: () => 'sw.js',
          },
        },
      });
    },
  };
}
