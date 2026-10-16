/**
 * `npm run api:dev`: the API Worker under wrangler, on a stand-in network.
 *
 * Locally, wrangler fills request.cf from a cached copy of the developer's
 * real one (fetched from Cloudflare into node_modules/.mf), so the local badge
 * (Prompt 4.4) would show their actual city. This passes a stand-in instead,
 * from workers/api/dev/, copied fresh into the gitignored .wrangler/ on every
 * start: miniflare re-fetches the real one into the configured path once the
 * file there is 30 days old, and it must never land in a committed file.
 *
 *   npm run api:dev                    a network in Bengaluru, India
 *   npm run api:dev -- --no-city       one Cloudflare places in no city
 *
 * Any other arguments go to wrangler (e.g. -- --port 8788).
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const noCity = process.argv.includes('--no-city');
const rest = process.argv.slice(2).filter((arg) => arg !== '--no-city');

const network = noCity ? 'network-no-city.json' : 'network-city.json';
const source = new URL(`../../workers/api/dev/${network}`, import.meta.url);
const target = new URL('../../workers/api/.wrangler/stand-in-network.json', import.meta.url);
mkdirSync(new URL('.', target), { recursive: true });
copyFileSync(source, target);
console.log(`api:dev: request.cf is the stand-in ${network}, not your network`);

const child = spawn('npx', ['wrangler', 'dev', '-c', 'workers/api/wrangler.jsonc', ...rest], {
  stdio: 'inherit',
  // npx is npx.cmd on Windows, which only a shell runs.
  shell: process.platform === 'win32',
  env: { ...process.env, CLOUDFLARE_CF_FETCH_PATH: fileURLToPath(target) },
});
child.on('exit', (code) => process.exit(code ?? 1));
