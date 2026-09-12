import { createClient } from '@supabase/supabase-js';
export const recoveryRequested = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery' || new URLSearchParams(window.location.hash.slice(1)).has('error_code');
const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT'));
export const supabase = configured ? createClient(url, key) : null;
