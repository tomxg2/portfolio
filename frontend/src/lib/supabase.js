import { createClient } from '@supabase/supabase-js';

// Frontend Supabase client — used for Realtime (presence + broadcast).
// Only the *anon* key belongs here. Service key stays in the backend.
//
// Returns null if env is missing, so callers can gracefully degrade
// (multiplayer features just disable themselves).
const url     = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (url && anonKey)
  ? createClient(url, anonKey, {
      auth: { persistSession: false }, // anonymous portfolio site, no login
      realtime: { params: { eventsPerSecond: 30 } },
    })
  : null;
