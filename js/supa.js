// Supabase client (library bundled locally in vendor/ so it works offline).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // tapping the e-mail link returns here with the session in the URL
    storageKey: 'ibfc-auth'
  }
});
