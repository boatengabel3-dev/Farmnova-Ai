-- ============================================================================
-- FarmNova AI — Per-Farm NASA POWER Telemetry Cache Table & RLS Policies
-- Caches 180-day daily NASA POWER points + 10-year monthly climatology per farm
-- so repeated requests for the same farm coordinates are not re-fetched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.farm_power_cache (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  farm_id TEXT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL,
  centroid_lat DOUBLE PRECISION NOT NULL,
  centroid_lon DOUBLE PRECISION NOT NULL,
  last_available_date TEXT,
  payload_json JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE (farm_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_farm_power_cache_farm_id ON public.farm_power_cache(farm_id);
CREATE INDEX IF NOT EXISTS idx_farm_power_cache_expires_at ON public.farm_power_cache(expires_at);

ALTER TABLE public.farm_power_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS farm_power_cache_owner_select ON public.farm_power_cache;
CREATE POLICY farm_power_cache_owner_select ON public.farm_power_cache
  FOR SELECT TO authenticated
  USING (
    owner_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_power_cache.farm_id
        AND f.owner_id = public.current_app_user_id()
    )
  );

DROP POLICY IF EXISTS farm_power_cache_owner_insert ON public.farm_power_cache;
CREATE POLICY farm_power_cache_owner_insert ON public.farm_power_cache
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_power_cache.farm_id
        AND f.owner_id = public.current_app_user_id()
    )
  );

DROP POLICY IF EXISTS farm_power_cache_owner_update ON public.farm_power_cache;
CREATE POLICY farm_power_cache_owner_update ON public.farm_power_cache
  FOR UPDATE TO authenticated
  USING (
    owner_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_power_cache.farm_id
        AND f.owner_id = public.current_app_user_id()
    )
  )
  WITH CHECK (
    owner_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_power_cache.farm_id
        AND f.owner_id = public.current_app_user_id()
    )
  );

DROP POLICY IF EXISTS farm_power_cache_owner_delete ON public.farm_power_cache;
CREATE POLICY farm_power_cache_owner_delete ON public.farm_power_cache
  FOR DELETE TO authenticated
  USING (
    owner_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = farm_power_cache.farm_id
        AND f.owner_id = public.current_app_user_id()
    )
  );
