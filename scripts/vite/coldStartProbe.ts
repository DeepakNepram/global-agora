/**
 * Cold-start probe, injected by the preview server (scripts/vite/devReports.ts)
 * as the first script of the page when it is loaded with `?coldstart`. It is
 * never part of the app bundle.
 *
 * It runs before any app code, so it can observe the page from navigation start:
 * the first WebGL draw, the moment the globe accepts keyboard input, and the
 * upload of each map (the frame a map is uploaded in is the frame it first
 * appears). When the tier's full maps are all on screen it posts the timings to
 * /__bench and shows them in a corner. Times are ms from navigation start.
 *
 *   earthOnScreen    first day map of any resolution (the preview, normally)
 *   fullDayOnScreen  the tier's own day map
 *   allOnScreen      every map at the tier's resolution
 */
export const COLD_START_PROBE = `(() => {
  const now = () => performance.now();
  const m = { fcp: null, firstDraw: null, inputReady: null, uploads: {} };
  window.__coldStart = m;

  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') m.fcp = e.startTime;
  }).observe({ type: 'paint', buffered: true });

  const gl = WebGL2RenderingContext.prototype;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = gl[name];
    gl[name] = function (...args) {
      if (m.firstDraw === null) m.firstDraw = now();
      return original.apply(this, args);
    };
  }
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const original = gl[name];
    gl[name] = function (...args) {
      const image = args.find((a) => a && typeof a === 'object' && typeof a.src === 'string');
      const match = image && /(day|night|specular|clouds)-(\\d+)\\.webp/.exec(image.src);
      const result = original.apply(this, args);
      if (match && m.uploads[match[1] + '-' + match[2]] === undefined) {
        m.uploads[match[1] + '-' + match[2]] = now();
      }
      return result;
    };
  }
  const addListener = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, ...rest) {
    if (type === 'keydown' && m.inputReady === null && this instanceof HTMLElement &&
        this.getAttribute('role') === 'application') m.inputReady = now();
    return addListener.call(this, type, ...rest);
  };

  const WIDTH = { low: 2048, medium: 4096, high: 8192 };
  const fullMaps = (width) =>
    ['day-' + width, 'night-' + width, 'specular-' + width, 'clouds-' + Math.min(width, 2048)];
  const tierNow = () => document.querySelector('[data-testid=quality-tier]')?.textContent?.trim();
  const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v));

  const finish = async () => {
    const deadline = now() + 60000;
    const complete = () => {
      const width = WIDTH[tierNow()];
      return Boolean(width) && fullMaps(width).every((key) => m.uploads[key] !== undefined);
    };
    while (!complete() && now() < deadline) await new Promise((r) => setTimeout(r, 100));

    const tier = tierNow() ?? null;
    const width = WIDTH[tier] ?? 0;
    const days = Object.keys(m.uploads).filter((key) => key.startsWith('day-')).map((key) => m.uploads[key]);
    const resources = performance.getEntriesByType('resource');
    const canvas = document.querySelector('canvas');
    const context = canvas && canvas.getContext('webgl2');
    const info = context && context.getExtension('WEBGL_debug_renderer_info');
    const result = {
      kind: 'coldstart',
      tier,
      complete: complete(),
      fcp: round(m.fcp),
      jsFetched: round(resources.find((r) => /assets\\/index-.*\\.js/.test(r.name))?.responseEnd),
      firstDraw: round(m.firstDraw),
      inputReady: round(m.inputReady),
      earthOnScreen: round(days.length ? Math.min(...days) : null),
      fullDayOnScreen: round(m.uploads['day-' + width]),
      allOnScreen: round(Math.max(...fullMaps(width).map((key) => m.uploads[key] ?? NaN))),
      transferKiB: Math.round(resources.reduce((sum, r) => sum + (r.transferSize || 0), 0) / 1024),
      uploads: Object.fromEntries(Object.entries(m.uploads).map(([k, v]) => [k, Math.round(v)])),
      renderer: info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      userAgent: navigator.userAgent,
      viewport: innerWidth + 'x' + innerHeight + '@' + devicePixelRatio,
    };
    window.__coldResult = result;

    let sent = false;
    try {
      sent = (await fetch('/__bench', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      })).ok;
    } catch {}
    const s = (ms) => (ms == null ? 'n/a' : (ms / 1000).toFixed(2) + ' s');
    const note = document.createElement('p');
    note.setAttribute('role', 'status');
    note.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:9999;margin:0;' +
      'padding:8px;background:#000d;color:#fff;font:12px/1.4 monospace';
    note.textContent = 'Cold start (' + tier + '): Earth ' + s(result.earthOnScreen) +
      ' · full day map ' + s(result.fullDayOnScreen) + ' · all maps ' + s(result.allOnScreen) +
      (sent ? ' · sent to the dev server' : ' · NOT sent');
    document.body.append(note);
  };
  addEventListener('load', () => void finish());
})();`;
