import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY が未設定です。");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    experimental: {
      passkey: true,
    },
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
