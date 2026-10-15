import { useEffect } from 'react';

import type { DbConfig } from '@/core/db/config';
import { startAccounts } from '@/state';

/**
 * Starts the account side (src/state/accounts.ts): resumes a stored session,
 * or finishes a sign-in that just returned to the page. A guest, or a build
 * without a backend, loads nothing.
 */
export function useAccountSession(config: DbConfig | null): void {
  useEffect(() => startAccounts(config), [config]);
}
