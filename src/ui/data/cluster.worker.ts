/**
 * The clustering Web Worker: supercluster runs here so building an index or
 * answering a zoom level never blocks a frame. All the logic is in
 * src/core/cluster/engine.ts; this file only connects it to the worker's
 * message port, and is the one module that pulls supercluster into a bundle.
 */

import { createClusterEngine, handleClusterRequest } from '@/core/cluster/engine';
import type { ClusterReply, ClusterRequest } from '@/core/cluster/protocol';

/**
 * The slice of DedicatedWorkerGlobalScope used here, declared locally: the
 * project compiles against the DOM lib, whose `self` is a Window.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<ClusterRequest>) => void) | null;
  postMessage(message: ClusterReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const engine = createClusterEngine();

scope.onmessage = (event) => {
  const handled = handleClusterRequest(engine, event.data);
  if (handled) scope.postMessage(handled.reply, handled.transfer);
};
