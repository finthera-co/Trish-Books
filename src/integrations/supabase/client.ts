import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { initBrowserSessionGuard } from '@/lib/browserSession';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// Discards any session left behind by a previous browser session. Must run
// before createClient, which reads storage as it initialises.
initBrowserSessionGuard();

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});