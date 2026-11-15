import { getSupabaseClient, isSupabaseClientConfigured } from './supabase';
import type { EnvironmentalAnalysis, Farm } from '../types';

const TTL_MS = 12 * 3600 * 1000;

function buildCacheKey(farm: Farm): string {
  const lat = Number(farm.centroidLat.toFixed(4));
  const lon = Number(farm.centroidLon.toFixed(4));
  return `power_180d_climo10y_${lat}_${lon}_v3`;
}

export async function readFarmPowerCache(farm: Farm): Promise<EnvironmentalAnalysis | null> {
  const cacheKey = buildCacheKey(farm);
  const localKey = `farmnova_power_${farm.id}_${cacheKey}`;

  // 1. Try per-farm Supabase RLS table `farm_power_cache` if authenticated
  const supabase = getSupabaseClient();
  if (isSupabaseClientConfigured && supabase) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session) {
        const { data } = await supabase
          .from('farm_power_cache')
          .select('payload_json, expires_at')
          .eq('farm_id', farm.id)
          .eq('cache_key', cacheKey)
          .maybeSingle();

        if (data && data.expires_at && new Date(data.expires_at).getTime() > Date.now() && data.payload_json) {
          return { ...(data.payload_json as EnvironmentalAnalysis), farmId: farm.id, cacheHit: true };
        }
      }
    } catch {
      // Fall back to local cache gracefully if table isn't migrated yet
    }
  }

  // 2. Local per-farm browser cache fallback
  try {
    const raw = localStorage.getItem(localKey);
    if (raw) {
      const parsed = JSON.parse(raw) as { expiresAt: number; analysis: EnvironmentalAnalysis };
      if (parsed.expiresAt > Date.now() && parsed.analysis) {
        return { ...parsed.analysis, farmId: farm.id, cacheHit: true };
      }
    }
  } catch {
    // ignore corrupted local cache
  }

  return null;
}

export async function writeFarmPowerCache(farm: Farm, analysis: EnvironmentalAnalysis): Promise<void> {
  const cacheKey = buildCacheKey(farm);
  const localKey = `farmnova_power_${farm.id}_${cacheKey}`;
  const expiresAtIso = new Date(Date.now() + TTL_MS).toISOString();

  // Save in local per-farm cache
  try {
    localStorage.setItem(
      localKey,
      JSON.stringify({ expiresAt: Date.now() + TTL_MS, analysis })
    );
  } catch {
    // ignore storage quota errors
  }

  // Save in Supabase `farm_power_cache` with strict RLS when authenticated
  const supabase = getSupabaseClient();
  if (isSupabaseClientConfigured && supabase) {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return;

      const { data: appUser } = await supabase
        .from('users')
        .select('id')
        .eq('auth_uid', sessionData.session.user.id)
        .maybeSingle();

      if (!appUser?.id) return;

      await supabase.from('farm_power_cache').upsert(
        {
          farm_id: farm.id,
          owner_id: appUser.id,
          cache_key: cacheKey,
          centroid_lat: Number(farm.centroidLat.toFixed(4)),
          centroid_lon: Number(farm.centroidLon.toFixed(4)),
          last_available_date: analysis.lastAvailableDate,
          payload_json: analysis,
          fetched_at: analysis.fetchedAt,
          expires_at: expiresAtIso,
        },
        { onConflict: 'farm_id,cache_key' }
      );
    } catch {
      // Non-fatal if migration hasn't been executed yet
    }
  }
}
