-- ============================================================================
-- FarmNova AI — Supabase PostgreSQL Database Schema & Row Level Security (RLS)
-- Paste into Supabase Dashboard -> SQL Editor -> Run (or deploy via Supabase CLI)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helper trigger function for automatic updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 1. Users / Profiles
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  auth_uid UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'farmer' CHECK (role IN ('farmer', 'expert', 'researcher', 'admin')),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_token TEXT,
  reset_token TEXT,
  reset_expires BIGINT,
  organization TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  preferred_units TEXT NOT NULL DEFAULT 'metric' CHECK (preferred_units IN ('metric', 'imperial')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Application Sessions (used if custom session auth is active alongside Supabase)
CREATE TABLE IF NOT EXISTS public.sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Farms (Strict Owner Isolation)
CREATE TABLE IF NOT EXISTS public.farms (
  id TEXT PRIMARY KEY DEFAULT ('farm-' || substr(gen_random_uuid()::text, 1, 8)),
  owner_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  region TEXT NOT NULL,
  district TEXT NOT NULL DEFAULT '',
  size_hectares DOUBLE PRECISION NOT NULL CHECK (size_hectares > 0),
  farming_type TEXT NOT NULL,
  centroid_lat DOUBLE PRECISION NOT NULL CHECK (centroid_lat BETWEEN -90 AND 90),
  centroid_lon DOUBLE PRECISION NOT NULL CHECK (centroid_lon BETWEEN -180 AND 180),
  polygon_geojson JSONB NOT NULL DEFAULT '[]'::jsonb,
  soil_type TEXT NOT NULL DEFAULT 'Unknown',
  soil_texture TEXT NOT NULL DEFAULT 'Unknown',
  drainage TEXT NOT NULL DEFAULT 'Unknown',
  soil_fertility TEXT NOT NULL DEFAULT 'Unknown',
  organic_matter_pct DOUBLE PRECISION,
  soil_ph DOUBLE PRECISION,
  irrigation_available TEXT NOT NULL DEFAULT 'None (rainfed)',
  soil_notes TEXT NOT NULL DEFAULT '',
  previous_crops_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_crops_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  planned_crops_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  planting_seasons TEXT NOT NULL DEFAULT 'Main rainy season',
  harvest_periods TEXT NOT NULL DEFAULT 'End of rainy season',
  pest_history TEXT NOT NULL DEFAULT '',
  available_water TEXT NOT NULL DEFAULT 'Rainfed',
  equipment_notes TEXT NOT NULL DEFAULT '',
  market_preferences TEXT NOT NULL DEFAULT '',
  priorities_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farms_owner_id ON public.farms(owner_id);

DROP TRIGGER IF EXISTS trg_farms_updated_at ON public.farms;
CREATE TRIGGER trg_farms_updated_at
  BEFORE UPDATE ON public.farms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 4. Crop Intelligence Catalog
CREATE TABLE IF NOT EXISTS public.crops (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  scientific_name TEXT NOT NULL,
  family TEXT NOT NULL,
  growing_duration_days TEXT NOT NULL,
  water_req_mm TEXT NOT NULL,
  water_tier TEXT NOT NULL CHECK (water_tier IN ('Low', 'Moderate', 'High')),
  temp_min_c DOUBLE PRECISION NOT NULL,
  temp_opt_min_c DOUBLE PRECISION NOT NULL,
  temp_opt_max_c DOUBLE PRECISION NOT NULL,
  temp_max_c DOUBLE PRECISION NOT NULL,
  soil_preference TEXT NOT NULL,
  ph_min DOUBLE PRECISION NOT NULL,
  ph_max DOUBLE PRECISION NOT NULL,
  rooting_depth_cm TEXT NOT NULL,
  rooting_type TEXT NOT NULL,
  nutrient_demand TEXT NOT NULL CHECK (nutrient_demand IN ('Light', 'Moderate', 'Heavy')),
  nitrogen_fixing_kg_ha DOUBLE PRECISION NOT NULL DEFAULT 0,
  organic_matter_contrib TEXT NOT NULL CHECK (organic_matter_contrib IN ('Low', 'Moderate', 'High')),
  forage_potential TEXT NOT NULL,
  pest_disease_notes TEXT NOT NULL,
  suitable_seasons TEXT NOT NULL,
  compatible_predecessors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  incompatible_predecessors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  regions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_crops_updated_at ON public.crops;
CREATE TRIGGER trg_crops_updated_at
  BEFORE UPDATE ON public.crops
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 5. NASA / Edge Telemetry Cache
CREATE TABLE IF NOT EXISTS public.nasa_cache (
  cache_key TEXT PRIMARY KEY,
  payload_json JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nasa_cache_expires_at ON public.nasa_cache(expires_at);

-- 6. NASA Dataset Provenance Configurations
CREATE TABLE IF NOT EXISTS public.dataset_configs (
  id TEXT PRIMARY KEY,
  dataset_name TEXT NOT NULL,
  mission_code TEXT NOT NULL,
  data_source TEXT NOT NULL,
  spatial_resolution TEXT NOT NULL,
  temporal_resolution TEXT NOT NULL,
  processing_method TEXT NOT NULL,
  limitations TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- 7. AI Assistant Settings
CREATE TABLE IF NOT EXISTS public.ai_settings (
  id TEXT PRIMARY KEY,
  model_name TEXT NOT NULL,
  system_tone TEXT NOT NULL,
  strict_scientific_disclaimer BOOLEAN NOT NULL DEFAULT TRUE,
  max_history_turns INTEGER NOT NULL DEFAULT 12 CHECK (max_history_turns BETWEEN 4 AND 24),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Platform Announcements
CREATE TABLE IF NOT EXISTS public.announcements (
  id TEXT PRIMARY KEY DEFAULT ('ann-' || substr(gen_random_uuid()::text, 1, 8)),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'advisory', 'maintenance')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Security & Edge Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES public.users(id) ON DELETE SET NULL,
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  details TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT 'edge',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- 10. AI Assistant & Edge Chat History
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  farm_id TEXT NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_farm_user ON public.chat_messages(farm_id, user_id, created_at);

-- ============================================================================
-- Helper Function for Role Checks in RLS Policies
-- ============================================================================
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.users WHERE auth_uid = auth.uid() LIMIT 1;
$$;

-- ============================================================================
-- Enable Row Level Security (RLS)
-- ============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nasa_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dataset_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Users: read/update own profile; admins can manage users
CREATE POLICY users_select_own_or_admin ON public.users
  FOR SELECT TO authenticated
  USING (auth_uid = auth.uid() OR public.current_app_role() = 'admin');

CREATE POLICY users_insert_self_farmer ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth_uid = auth.uid() AND role = 'farmer');

CREATE POLICY users_update_own_or_admin ON public.users
  FOR UPDATE TO authenticated
  USING (auth_uid = auth.uid() OR public.current_app_role() = 'admin')
  WITH CHECK (auth_uid = auth.uid() OR public.current_app_role() = 'admin');

-- Farms: strictly isolated to the farm owner
CREATE POLICY farms_owner_select ON public.farms
  FOR SELECT TO authenticated
  USING (owner_id = public.current_app_user_id());

CREATE POLICY farms_owner_insert ON public.farms
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = public.current_app_user_id());

CREATE POLICY farms_owner_update ON public.farms
  FOR UPDATE TO authenticated
  USING (owner_id = public.current_app_user_id())
  WITH CHECK (owner_id = public.current_app_user_id());

CREATE POLICY farms_owner_delete ON public.farms
  FOR DELETE TO authenticated
  USING (owner_id = public.current_app_user_id());

-- Chat Messages: strictly isolated to the owner of the farm & thread
CREATE POLICY chat_owner_all ON public.chat_messages
  FOR ALL TO authenticated
  USING (
    user_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = chat_messages.farm_id AND f.owner_id = public.current_app_user_id()
    )
  )
  WITH CHECK (
    user_id = public.current_app_user_id()
    AND EXISTS (
      SELECT 1 FROM public.farms f
      WHERE f.id = chat_messages.farm_id AND f.owner_id = public.current_app_user_id()
    )
  );

-- Crops: readable by authenticated users; curated by experts and admins
CREATE POLICY crops_read_all ON public.crops
  FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY crops_write_expert_admin ON public.crops
  FOR ALL TO authenticated
  USING (public.current_app_role() IN ('expert', 'admin'))
  WITH CHECK (public.current_app_role() IN ('expert', 'admin'));

-- Dataset Configs & AI Settings: readable by authenticated users; managed by admins
CREATE POLICY datasets_read_all ON public.dataset_configs
  FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY datasets_admin_manage ON public.dataset_configs
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

CREATE POLICY ai_settings_read_all ON public.ai_settings
  FOR SELECT TO authenticated
  USING (TRUE);

CREATE POLICY ai_settings_admin_manage ON public.ai_settings
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

-- Announcements: active notices readable publicly; managed by admins
CREATE POLICY announcements_read_active ON public.announcements
  FOR SELECT TO anon, authenticated
  USING (active = TRUE OR public.current_app_role() = 'admin');

CREATE POLICY announcements_admin_manage ON public.announcements
  FOR ALL TO authenticated
  USING (public.current_app_role() = 'admin')
  WITH CHECK (public.current_app_role() = 'admin');

-- Audit Logs: admin-only read access (Edge Functions / service_role write via bypass)
CREATE POLICY audit_logs_admin_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.current_app_role() = 'admin');

-- ============================================================================
-- Seed Default Platform Configuration
-- ============================================================================
INSERT INTO public.ai_settings (id, model_name, system_tone, strict_scientific_disclaimer, max_history_turns)
VALUES (
  'default',
  'gemini-4-hydrogen',
  'Practical, respectful agronomic advisor grounded in empirical observation',
  TRUE,
  12
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dataset_configs (id, dataset_name, mission_code, data_source, spatial_resolution, temporal_resolution, processing_method, limitations, enabled)
VALUES
  ('power', 'NASA POWER Agroclimatology Daily & Monthly', 'POWER', 'NASA Langley Research Center (POWER API v2 / MERRA-2 & CERES)', '0.5° × 0.625° (~55 km grid)', 'Daily & Monthly (4–7 day operational latency)', 'Live API query for farm centroid with missing-value (-999) filtering and FAO-56 Penman-Monteith ET0 harmonization', 'Gridded regional meteorology (~55 km); localized convective storms, microclimate shade, and field-level irrigation are not resolved.', TRUE),
  ('gpm', 'NASA GPM IMERG Precipitation Context', 'GPM', 'NASA Goddard Earth Sciences (GPM IMERG / POWER PRECTOTCORR)', '0.1° (~11 km native IMERG) / 0.5° harmonized', '30-minute native / Daily aggregated rainfall', 'Bias-adjusted satellite precipitation accumulation, dry-spell streak (>10d <1mm) and extreme rain (>30mm/d) indexing', 'Satellite rainfall estimates can under- or over-estimate intense localized tropical squalls compared with an on-farm rain gauge.', TRUE),
  ('smap', 'NASA SMAP Root-Zone & Surface Soil Moisture', 'SMAP', 'NASA NSIDC SMAP L4 / GEOS-5 Assimilated Wetness (GWETTOP & GWETROOT)', '9 km (SMAP L4) / 0.5° surface-root wetness index', 'Daily assimilated 0–5 cm & 0–100 cm profile', 'Dimensionless soil wetness (0–1) compared against multi-year monthly seasonal baseline anomalies', 'Measures regional top-layer and assimilated root-zone wetness across multi-kilometer footprints; does not measure exact field-plot volumetric moisture or soil organic carbon.', TRUE),
  ('srtm', 'NASA SRTM / Copernicus Digital Elevation Model', 'SRTM', 'NASA Shuttle Radar Topography Mission / 30m-90m DEM via Open-Meteo Elevation API', '30 m – 90 m', 'Static baseline terrain surface', 'Multi-point elevation sampling across farm centroid and boundary offsets to estimate slope gradient (%) and runoff exposure', 'Does not capture recent micro-terracing, bunds, or seasonal tillage ridges built after DEM acquisition.', TRUE),
  ('modis', 'NASA MODIS Terra 8-Day Vegetation & Thermal Context', 'MODIS', 'NASA LP DAAC / GIBS WMTS (MOD13Q1 / MOD09Q1 / MOD11A2)', '250 m (NDVI) – 1 km (LST)', '8-day / 16-day composite', 'Tiled WMTS orbital overlay in Leaflet map; paired with agroclimatic water-balance vegetation stress proxy', '250 m pixels frequently mix multiple smallholder plots, hedgerows, and fallow patches; cloud cover during wet seasons limits optical retrieval.', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.announcements (id, title, body, severity, active, created_by)
VALUES (
  'ann-1',
  'NASA POWER & GIBS Satellite Harmonisation Active',
  'Daily precipitation, 2m temperature, root-zone soil wetness, and SRTM terrain elevation are live-queried for registered farm coordinates. Remember that gridded 0.5° meteorology complements—never replaces—on-farm soil testing.',
  'info',
  TRUE,
  'FarmNova AI Platform Admin'
)
ON CONFLICT (id) DO NOTHING;
