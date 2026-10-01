/**
 * Where the Supabase SDK keeps a signed-in session (localStorage). A fixed
 * key rather than the SDK's per-project default, so the app can tell whether
 * anyone is signed in without loading the SDK: guests never download it.
 */
export const AUTH_STORAGE_KEY = 'agora.auth.v1';
