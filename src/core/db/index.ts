/**
 * src/core/db: Supabase access.
 *
 * Deliberately not re-exported from src/core/index.ts. Importing this pulls in
 * the Supabase SDK (~54 kB gzip), so callers opt in with `@/core/db`, ideally
 * through a dynamic import, and the globe's cold start never pays for it.
 *
 * types.ts is generated from the local database: run `npm run db:types` after
 * changing a migration, and never edit it by hand.
 */
export { assertPublicKey, createDbClient, dbConfigFromEnv } from './client';
export type { DbClient, DbClientOptions, DbConfig } from './client';
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from './types';
