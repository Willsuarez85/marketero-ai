import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[db:client] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — database calls will fail');
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export { supabase };

/**
 * Checks connectivity to the Supabase database by querying the restaurants table.
 * @returns {Promise<boolean>} True if the database is reachable, false otherwise.
 */
export async function healthCheck() {
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('restaurants')
      .select('id', { count: 'exact', head: true });

    if (error) {
      console.error('[db:client] Health check failed:', error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[db:client] Health check exception:', err.message);
    return false;
  }
}
