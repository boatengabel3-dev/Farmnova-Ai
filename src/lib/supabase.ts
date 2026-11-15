import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = import.meta.env as Record<string, string | undefined>;

function normalizeSupabaseUrl(raw: string | undefined): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (/^[a-z0-9-]+$/i.test(trimmed)) return `https://${trimmed}.supabase.co`;
  return '';
}

const supabaseUrl =
  normalizeSupabaseUrl(env.VITE_SUPABASE_URL) ||
  normalizeSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = (
  env.VITE_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();

export const SUPABASE_EDGE_FUNCTION_SLUG =
  (env.VITE_SUPABASE_EDGE_FUNCTION_SLUG || 'farmnova-edge').trim();

export const supabaseUrlValue = supabaseUrl;
export const isSupabaseClientConfigured = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl.startsWith('http'));

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseClientConfigured) return null;
  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return cachedClient;
}
