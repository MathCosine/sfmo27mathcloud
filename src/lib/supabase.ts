import { createClient } from '@supabase/supabase-js';
import { ApiError, staffRecovery, type Backend } from './api';

/** Errors worth retrying: the request never got a clear answer from the database. */
function transient(status: number, message: string) {
  return status === 0 || status === 408 || status === 429 || status >= 500 || /fetch|network|timeout|aborted/i.test(message);
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sfmo27-staff', flowType: 'pkce', detectSessionInUrl: true },
  });
  // Links in password-reset emails come back as ?to=staff&code=...; supabase-js
  // swaps the code for a session, and this tells the staff page to ask for a new password.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') staffRecovery.set(true);
  });
  const back = () => location.origin + location.pathname + '?to=staff';

  return {
    kind: 'supabase',
    async call(fn, p, signal) {
      let q = sb.rpc(fn, { p });
      if (signal) q = q.abortSignal(signal);
      const { data, error, status } = await q;
      if (error) {
        if (error.code === 'P0001') throw new ApiError(error.message, error.hint || 'error');
        if (error.code === '42501') throw new ApiError('You don\'t have access to that.', 'forbidden');
        if (transient(status, error.message)) throw new ApiError('Could not reach the server. Retrying…', 'network', true);
        throw new ApiError(error.message || 'Something went wrong.', error.code || 'error');
      }
      return data;
    },
    staff: {
      async current() {
        const { data } = await sb.auth.getSession();
        const u = data.session?.user;
        return u ? { id: u.id, email: u.email ?? '' } : null;
      },
      async signIn(email, password) {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new ApiError(error.message === 'Invalid login credentials' ? 'That email and password don\'t match.' : error.message, 'auth');
      },
      async signUp(email, password) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: back() } });
        if (error) throw new ApiError(error.message, 'auth');
        return { confirm: !data.session };
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async resetPassword(email) {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: back() });
        if (error) throw new ApiError(error.message, 'auth');
      },
      async updatePassword(password) {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw new ApiError(error.message, 'auth');
        staffRecovery.set(false);
      },
    },
  };
}
