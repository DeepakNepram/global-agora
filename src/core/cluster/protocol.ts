import type { ClusterLayout } from './layout';

/**
 * Messages between the cluster client (main thread) and the engine (a Web
 * Worker). Plain objects of typed arrays, so they structured-clone cheaply and
 * a layout's buffers can be transferred rather than copied.
 */

/** The story columns the engine clusters, copied to exactly `count` rows. */
export interface ClusterColumns {
  readonly count: number;
  readonly epochSec: number;
  readonly ids: Uint32Array;
  readonly positions: Float32Array;
  readonly heat: Uint8Array;
  readonly categories: Uint8Array;
  readonly publishedSec: Int32Array;
}

export interface ClusterLoadRequest {
  readonly type: 'load';
  readonly generation: number;
  readonly columns: ClusterColumns;
}

export interface ClusterLayoutRequest {
  readonly type: 'layout';
  readonly generation: number;
  /** Increases with every request; only the latest one's reply is used. */
  readonly request: number;
  readonly level: number;
  /** Stories published after this instant (epoch seconds) are left out of clusters. */
  readonly nowSec: number;
  /** The time is moving: open every cluster (see ClusterLayout.open). */
  readonly open: boolean;
}

export type ClusterRequest = ClusterLoadRequest | ClusterLayoutRequest;

export interface ClusterLayoutReply {
  readonly type: 'layout';
  readonly request: number;
  readonly layout: ClusterLayout;
}

export interface ClusterErrorReply {
  readonly type: 'error';
  readonly request: number;
  readonly message: string;
}

export type ClusterReply = ClusterLayoutReply | ClusterErrorReply;

/** The buffers a layout reply can hand over instead of copying. */
export function layoutBuffers(layout: ClusterLayout): ArrayBuffer[] {
  return [
    layout.roles.buffer,
    layout.groups.buffer,
    layout.anchors.buffer,
    layout.counts.buffer,
    layout.categories.buffer,
    layout.petals.buffer,
  ].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
}
