import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Cache Supabase clients by project ID to avoid creating duplicates
const clientCache = new Map<string, SupabaseClient>();

/**
 * Get a Supabase client for a specific project.
 * Uses environment variables: NEXT_PUBLIC_{PROJECT_ID}_SUPABASE_URL and _ANON_KEY
 */
export function getSupabaseClient(projectId: string): SupabaseClient | null {
  // Return cached client if available
  if (clientCache.has(projectId)) {
    return clientCache.get(projectId)!;
  }

  const envPrefix = projectId.toUpperCase();
  const url = process.env[`NEXT_PUBLIC_${envPrefix}_SUPABASE_URL`] || '';
  const key = process.env[`NEXT_PUBLIC_${envPrefix}_SUPABASE_ANON_KEY`] || '';

  if (!url || !url.startsWith('http')) {
    console.warn(`No Supabase config for project "${projectId}". Set NEXT_PUBLIC_${envPrefix}_SUPABASE_URL and _ANON_KEY.`);
    return null;
  }

  const client = createClient(url, key);
  clientCache.set(projectId, client);
  return client;
}

// Legacy default export for backward compat (uses GlowUp)
const supabase = getSupabaseClient('glowup') || createClient('https://placeholder.supabase.co', 'placeholder');
export { supabase };
