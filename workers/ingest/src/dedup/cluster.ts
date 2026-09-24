/**
 * Grouping one batch: articles -> write-ups -> events.
 *
 * 1. Write-ups. Articles whose headlines are within 3 simhash bits are one
 *    write-up carried by several outlets (42 Newsquest papers ran one PA story
 *    on 2026-09-24). A second copy on the same domain is a duplicate and goes;
 *    copies on other domains stay as articles but count as syndication in heat.
 * 2. Events. Write-ups join a cluster when they share distinctive keys with it
 *    (keys.ts: sameEvent). Leader-follower, largest write-ups first. A
 *    cluster's signature holds only keys that at least a quarter of its
 *    write-ups have, so one loosely related member cannot chain in the next.
 */

import type { IngestArticle } from '../normalize/article.ts';

import { eventKeys, sameEvent, sharedKeys } from './keys.ts';
import { bands, isNearDuplicate, simhash, type Simhash } from './simhash.ts';

export interface Writeup {
  readonly hash: Simhash;
  /** One article per outlet, earliest seen first. */
  readonly articles: IngestArticle[];
  /** Union of its copies' keys: GDELT extracts slightly different entities per copy. */
  readonly keys: ReadonlySet<string>;
}

export interface Cluster {
  readonly writeups: Writeup[];
  /** Key -> number of write-ups that have it. */
  readonly keyCounts: Map<string, number>;
}

/** Keys held by at least this share of a cluster's write-ups form its signature. */
export const SIGNATURE_SUPPORT = 0.25;
export const MAX_SIGNATURE_KEYS = 48;

function byTimeThenUrl(a: IngestArticle, b: IngestArticle): number {
  return a.seenAt - b.seenAt || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

/** Near-duplicate headlines become write-ups; same-domain copies are dropped. */
export function groupWriteups(
  articles: readonly IngestArticle[],
  common?: ReadonlySet<string>,
): { writeups: Writeup[]; sameOutletDuplicates: number } {
  const sorted = [...articles].sort(byTimeThenUrl);
  const hashes = sorted.map((article) => simhash(article.normalized));

  // Union-find over near-duplicate pairs, found through the band buckets.
  const parent = sorted.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] ?? root;
    while (parent[i] !== root) {
      const next = parent[i] ?? root;
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const buckets = new Map<string, number[]>();
  hashes.forEach((hash, i) => {
    bands(hash).forEach((band, b) => {
      const bucketKey = `${b}:${band}`;
      const bucket = buckets.get(bucketKey);
      if (bucket === undefined) {
        buckets.set(bucketKey, [i]);
        return;
      }
      for (const j of bucket) {
        const hi = hashes[j];
        if (hi !== undefined && isNearDuplicate(hash, hi)) parent[find(i)] = find(j);
      }
      bucket.push(i);
    });
  });

  const groups = new Map<number, number[]>();
  sorted.forEach((_, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (group === undefined) groups.set(root, [i]);
    else group.push(i);
  });

  let sameOutletDuplicates = 0;
  const writeups: Writeup[] = [];
  for (const members of groups.values()) {
    const seen = new Set<string>();
    const kept: IngestArticle[] = [];
    const keys = new Set<string>();
    for (const i of members) {
      const article = sorted[i];
      if (article === undefined) continue;
      if (seen.has(article.outlet)) {
        sameOutletDuplicates++;
        continue;
      }
      seen.add(article.outlet);
      kept.push(article);
      for (const key of eventKeys(article, common)) keys.add(key);
    }
    const lead = members[0];
    if (lead !== undefined && kept.length > 0) {
      writeups.push({ hash: hashes[lead] ?? { hi: 0, lo: 0 }, articles: kept, keys });
    }
  }
  return { writeups, sameOutletDuplicates };
}

/** The keys that at least a quarter of the write-ups share, most supported first. */
export function signature(keyCounts: ReadonlyMap<string, number>, writeups: number): string[] {
  const floor = Math.max(1, Math.ceil(writeups * SIGNATURE_SUPPORT));
  return [...keyCounts]
    .filter(([, count]) => count >= floor)
    .sort(([ka, a], [kb, b]) => b - a || (ka < kb ? -1 : 1))
    .slice(0, MAX_SIGNATURE_KEYS)
    .map(([key]) => key);
}

const NO_KEYS: ReadonlySet<string> = new Set();

/** A write-up's earliest article; groupWriteups never emits an empty one. */
function lead(writeup: Writeup): IngestArticle {
  const first = writeup.articles[0];
  if (first === undefined) throw new Error('empty write-up');
  return first;
}

function addWriteup(cluster: Cluster, writeup: Writeup): void {
  cluster.writeups.push(writeup);
  for (const key of writeup.keys) cluster.keyCounts.set(key, (cluster.keyCounts.get(key) ?? 0) + 1);
}

/** Groups write-ups into events. Deterministic for a given input. */
export function clusterWriteups(writeups: readonly Writeup[]): Cluster[] {
  const ordered = [...writeups].sort(
    (a, b) => b.articles.length - a.articles.length || byTimeThenUrl(lead(a), lead(b)),
  );

  const clusters: Cluster[] = [];
  const signatures: Set<string>[] = [];
  const index = new Map<string, Set<number>>();

  for (const writeup of ordered) {
    const candidates = new Set<number>();
    for (const key of writeup.keys) for (const id of index.get(key) ?? []) candidates.add(id);

    let best = -1;
    let bestShared = 0;
    for (const id of candidates) {
      const cluster = clusters[id];
      const shared = sharedKeys(writeup.keys, signatures[id] ?? NO_KEYS);
      if (cluster === undefined || !sameEvent(shared)) continue;
      const current = clusters[best];
      if (
        shared.length > bestShared ||
        (shared.length === bestShared &&
          current !== undefined &&
          cluster.writeups.length > current.writeups.length)
      ) {
        best = id;
        bestShared = shared.length;
      }
    }

    const id = best >= 0 ? best : clusters.length;
    if (best < 0) clusters.push({ writeups: [], keyCounts: new Map() });
    const cluster = clusters[id];
    if (cluster === undefined) continue;
    addWriteup(cluster, writeup);
    signatures[id] = new Set(signature(cluster.keyCounts, cluster.writeups.length));
    for (const key of writeup.keys) {
      const ids = index.get(key) ?? new Set<number>();
      ids.add(id);
      index.set(key, ids);
    }
  }
  return clusters;
}

/** Every article of a cluster, earliest first. */
export function clusterArticles(cluster: Cluster): IngestArticle[] {
  return cluster.writeups.flatMap((w) => w.articles).sort(byTimeThenUrl);
}
