/**
 * Heat, 0-255: how widely and how fast a story is being reported.
 *
 *   I = independent sources = min(W, O) + s·max(0, O − W)
 *       W = distinct write-ups, O = distinct outlets, s = syndicated weight (¼)
 *   C = distinct source countries (outlets whose country is known)
 *   V = distinct outlets GDELT first saw in the hour up to this batch
 *
 *   sat(x, k) = min(1, ln(1 + x) / ln(1 + k))      0 at x = 0, 1 at x >= k
 *   heat = round(255 · (wI·sat(I − 1, kI) + wC·sat(C − 1, kC) + wV·sat(V, kV)))
 *
 * Defaults: wI 0.5, wC 0.3, wV 0.2; kI 49, kC 15, kV 30. So one article from one
 * outlet scores 10 (velocity only), and a story with 50 independent sources in
 * 16 countries, 30 of them in the last hour, scores 255. The logarithm makes
 * the first few sources count most: going from 1 to 5 sources moves heat more
 * than going from 40 to 50.
 *
 * Calibrated by replaying four real hours (npm run ingest:replay): the first
 * guess, kI 19 / kC 7 / kV 15, pinned seven stories at 255 and queued ~140 a
 * day at heat 215. These saturation points spread the top and queue ~36 a day,
 * inside the build plan's 20-60.
 *
 * Why independent sources rather than outlets: one wire story ran on 42
 * Newsquest papers on 2026-09-24. As 42 sources it would outrank a story ten
 * newsrooms reported separately; as one write-up plus 41 copies at ¼ it does
 * not. See docs/DECISIONS.md for the calibration.
 */

export interface HeatWeights {
  readonly sources: number;
  readonly countries: number;
  readonly velocity: number;
}

export interface HeatConfig {
  readonly weights: HeatWeights;
  /** The value of each input at which its term saturates. */
  readonly saturation: HeatWeights;
  /** What an extra outlet carrying an existing write-up counts for. */
  readonly syndicatedWeight: number;
}

export const DEFAULT_HEAT: HeatConfig = {
  weights: { sources: 0.5, countries: 0.3, velocity: 0.2 },
  saturation: { sources: 49, countries: 15, velocity: 30 },
  syndicatedWeight: 0.25,
};

export interface HeatInputs {
  /** Distinct write-ups (near-duplicate headline groups). */
  readonly writeups: number;
  /** Distinct outlets. */
  readonly outlets: number;
  /** Distinct known source countries. */
  readonly countries: number;
  /** Distinct outlets first seen in the last hour. */
  readonly velocity: number;
}

/** 0 at x <= 0, rising logarithmically to 1 at x = k. */
export function saturate(x: number, k: number): number {
  if (x <= 0 || k <= 0) return 0;
  return Math.min(1, Math.log1p(x) / Math.log1p(k));
}

export function independentSources(
  writeups: number,
  outlets: number,
  syndicatedWeight: number,
): number {
  return Math.min(writeups, outlets) + syndicatedWeight * Math.max(0, outlets - writeups);
}

export function heatScore(inputs: HeatInputs, config: HeatConfig = DEFAULT_HEAT): number {
  const { weights: w, saturation: k } = config;
  const sources = independentSources(inputs.writeups, inputs.outlets, config.syndicatedWeight);
  const score =
    w.sources * saturate(sources - 1, k.sources) +
    w.countries * saturate(inputs.countries - 1, k.countries) +
    w.velocity * saturate(inputs.velocity, k.velocity);
  return Math.max(0, Math.min(255, Math.round(255 * score)));
}
