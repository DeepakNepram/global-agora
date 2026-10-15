import { describe, expect, it } from 'vitest';

import { createAccountStore } from './accountStore';

describe('accountStore', () => {
  it('opens sign-in for a guest, with the reason it was asked for', () => {
    const store = createAccountStore();
    store.getState().openSignIn('Sign in to post.');
    expect(store.getState()).toMatchObject({ sheet: 'sign-in', reason: 'Sign in to post.' });
    store.getState().closeSheet();
    expect(store.getState()).toMatchObject({ sheet: null, reason: null });
  });

  it('opens the account sheet instead once signed in', () => {
    const store = createAccountStore();
    store.setState({ status: 'signed-in' });
    store.getState().openSignIn('Sign in to post.');
    expect(store.getState().sheet).toBe('account');
  });

  it('sends a reader with unfinished setup back to it', () => {
    const store = createAccountStore();
    store.setState({ status: 'setup', step: 'handle' });
    store.getState().openAccount();
    expect(store.getState().sheet).toBe('setup');
    store.getState().closeSheet();
    expect(store.getState().sheet).toBe('setup');
  });
});
