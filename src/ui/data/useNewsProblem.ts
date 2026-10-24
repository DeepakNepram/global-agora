import { useConnectivityStore, useNodesStore } from '@/state';

/**
 * Why there are no stories to show (Prompt 5.2), when there are none:
 *
 * - `empty`: the news arrived, with nothing in it.
 * - `failed`: it could not be loaded, and nothing is saved on the device.
 * - `offline`: the same, with the device offline.
 *
 * While it first loads, nothing: the header already says "Loading news…".
 */
export type NewsProblemKind = 'empty' | 'failed' | 'offline';

export function useNewsProblem(): NewsProblemKind | null {
  const nodes = useNodesStore((state) => state.nodes);
  const status = useNodesStore((state) => state.status);
  const online = useConnectivityStore((state) => state.online);
  if (nodes !== null) return nodes.count === 0 ? 'empty' : null;
  if (status !== 'error') return null;
  return online ? 'failed' : 'offline';
}
