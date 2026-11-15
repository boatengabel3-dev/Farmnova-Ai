import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Crop, DatasetProvenance } from '../src/types.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(path.join(dataDir, 'terravane.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('farmer', 'expert', 'researcher', 'admin')),
      verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      reset_expires INTEGER,
      organization TEXT DEFAULT '',
      region TEXT DEFAULT '',
      preferred_units TEXT NOT NULL DEFAULT 'metric',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS farms (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      country TEXT NOT NULL,
      region TEXT NOT NULL,
      district TEXT NOT NULL,
      size_hectares REAL NOT NULL,
      farming_type TEXT NOT NULL,
      centroid_lat REAL NOT NULL,
      centroid_lon REAL NOT NULL,
      polygon_geojson TEXT NOT NULL,
      soil_type TEXT NOT NULL,
      soil_texture TEXT NOT NULL,
      drainage TEXT NOT NULL,
      soil_fertility TEXT NOT NULL,
      organic_matter_pct REAL,
      soil_ph REAL,
      irrigation_available TEXT NOT NULL,
      soil_notes TEXT DEFAULT '',
      previous_crops_json TEXT NOT NULL,
      current_crops_json TEXT NOT NULL,
      planned_crops_json TEXT NOT NULL,
      planting_seasons TEXT NOT NULL,
      harvest_periods TEXT NOT NULL,
      pest_history TEXT DEFAULT '',
      available_water TEXT NOT NULL,
      equipment_notes TEXT DEFAULT '',
      market_preferences TEXT DEFAULT '',
      priorities_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crops (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      scientific_name TEXT NOT NULL,
      family TEXT NOT NULL,
      growing_duration_days TEXT NOT NULL,
      water_req_mm TEXT NOT NULL,
      water_tier TEXT NOT NULL,
      temp_min_c REAL NOT NULL,
      temp_opt_min_c REAL NOT NULL,
      temp_opt_max_c REAL NOT NULL,
      temp_max_c REAL NOT NULL,
      soil_preference TEXT NOT NULL,
      ph_min REAL NOT NULL,
      ph_max REAL NOT NULL,
      rooting_depth_cm TEXT NOT NULL,
      rooting_type TEXT NOT NULL,
      nutrient_demand TEXT NOT NULL,
      nitrogen_fixing_kg_ha REAL NOT NULL,
      organic_matter_contrib TEXT NOT NULL,
      forage_potential TEXT NOT NULL,
      pest_disease_notes TEXT NOT NULL,
      suitable_seasons TEXT NOT NULL,
      compatible_predecessors_json TEXT NOT NULL,
      incompatible_predecessors_json TEXT NOT NULL,
      regions_json TEXT NOT NULL,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nasa_cache (
      cache_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dataset_configs (
      id TEXT PRIMARY KEY,
      dataset_name TEXT NOT NULL,
      mission_code TEXT NOT NULL,
      data_source TEXT NOT NULL,
      spatial_resolution TEXT NOT NULL,
      temporal_resolution TEXT NOT NULL,
      processing_method TEXT NOT NULL,
      limitations TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      system_tone TEXT NOT NULL,
      strict_scientific_disclaimer INTEGER NOT NULL DEFAULT 1,
      max_history_turns INTEGER NOT NULL DEFAULT 12,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      severity TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      details TEXT NOT NULL,
      ip TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      farm_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (farm_id) REFERENCES farms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  seedInitialData();
}

export function writeAuditLog(
  userId: string | null,
  userEmail: string,
  action: string,
  resourceType: string,
  resourceId: string,
  details: string,
  ip = 'local'
) {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, user_email, action, resource_type, resource_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), userId, userEmail, action, resourceType, resourceId, details, ip, new Date().toISOString());
}

function seedInitialData() {
  const now = new Date().toISOString();

  // Seed default AI settings
  const existingAi = db.prepare(`SELECT id FROM ai_settings WHERE id = 'default'`).get();
  if (!existingAi) {
    db.prepare(
      `INSERT INTO ai_settings (id, model_name, system_tone, strict_scientific_disclaimer, max_history_turns, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('default', 'gemini-4-hydrogen', 'Practical, respectful agronomic advisor grounded in empirical observation', 1, 12, now);
  }

  // Seed NASA Dataset Provenance Configs
  const datasetCount = (db.prepare(`SELECT COUNT(*) as c FROM dataset_configs`).get() as { c: number }).c;
  if (datasetCount === 0) {
    const datasets: Omit<DatasetProvenance, 'observationDate' | 'dataQuality' | 'missingObservations'>[] = [
      {
        id: 'power',
        datasetName: 'NASA POWER Agroclimatology Daily & Monthly',
        missionCode: 'POWER',
        dataSource: 'NASA Langley Research Center (POWER API v2 / MERRA-2 & CERES)',
        spatialResolution: '0.5° × 0.625° (~55 km grid)',
        temporalResolution: 'Daily & Monthly (4–7 day operational latency)',
        processingMethod: 'Live API query for farm centroid with missing-value (-999) filtering and FAO-56 Penman-Monteith ET0 harmonization',
        limitations: 'Gridded regional meteorology (~55 km); localized convective storms, microclimate shade, and field-level irrigation are not resolved.',
        enabled: true,
      },
      {
        id: 'gpm',
        datasetName: 'NASA GPM IMERG Precipitation Context',
        missionCode: 'GPM',
        dataSource: 'NASA Goddard Earth Sciences (GPM IMERG / POWER PRECTOTCORR)',
        spatialResolution: '0.1° (~11 km native IMERG) / 0.5° harmonized',
        temporalResolution: '30-minute native / Daily aggregated rainfall',
        processingMethod: 'Bias-adjusted satellite precipitation accumulation, dry-spell streak (>10d <1mm) and extreme rain (>30mm/d) indexing',
        limitations: 'Satellite rainfall estimates can under- or over-estimate intense localized tropical squalls compared with an on-farm rain gauge.',
        enabled: true,
      },
      {
        id: 'smap',
        datasetName: 'NASA SMAP Root-Zone & Surface Soil Moisture',
        missionCode: 'SMAP',
        dataSource: 'NASA NSIDC SMAP L4 / GEOS-5 Assimilated Wetness (GWETTOP & GWETROOT)',
        spatialResolution: '9 km (SMAP L4) / 0.5° surface-root wetness index',
        temporalResolution: 'Daily assimilated 0–5 cm & 0–100 cm profile',
        processingMethod: 'Dimensionless soil wetness (0–1) compared against multi-year monthly seasonal baseline anomalies',
        limitations: 'Measures regional top-layer and assimilated root-zone wetness across multi-kilometer footprints; does not measure exact field-plot volumetric moisture or soil organic carbon.',
        enabled: true,
      },
      {
        id: 'srtm',
        datasetName: 'NASA SRTM / Copernicus Digital Elevation Model',
        missionCode: 'SRTM',
        dataSource: 'NASA Shuttle Radar Topography Mission / 30m-90m DEM via Open-Meteo Elevation API',
        spatialResolution: '30 m – 90 m',
        temporalResolution: 'Static baseline terrain surface',
        processingMethod: 'Multi-point elevation sampling across farm centroid and boundary offsets to estimate slope gradient (%) and runoff exposure',
        limitations: 'Does not capture recent micro-terracing, bunds, or seasonal tillage ridges built after DEM acquisition.',
        enabled: true,
      },
      {
        id: 'modis',
        datasetName: 'NASA MODIS Terra 8-Day Vegetation & Thermal Context',
        missionCode: 'MODIS',
        dataSource: 'NASA LP DAAC / GIBS WMTS (MOD13Q1 / MOD09Q1 / MOD11A2)',
        spatialResolution: '250 m (NDVI) – 1 km (LST)',
        temporalResolution: '8-day / 16-day composite',
        processingMethod: 'Tiled WMTS orbital overlay in Leaflet map; paired with agroclimatic water-balance vegetation stress proxy',
        limitations: '250 m pixels frequently mix multiple smallholder plots, hedgerows, and fallow patches; cloud cover during wet seasons limits optical retrieval.',
        enabled: true,
      },
      {
        id: 'landsat',
        datasetName: 'NASA/USGS Landsat 8–9 Optical Land Cover Context',
        missionCode: 'LANDSAT',
        dataSource: 'USGS / NASA Landsat Collection 2 (GIBS / STAC Metadata)',
        spatialResolution: '30 m',
        temporalResolution: '8–16 day revisit (cloud-dependent)',
        processingMethod: '30 m field-boundary visual context; optical vegetation interpretation requires cloud-free local overpass verification',
        limitations: 'Persistent wet-season cloud cover in West and East Africa often creates multi-week gaps during peak crop establishment.',
        enabled: true,
      },
      {
        id: 'ecostress',
        datasetName: 'NASA ECOSTRESS Evapotranspiration & Thermal Stress',
        missionCode: 'ECOSTRESS',
        dataSource: 'NASA JPL ECOSTRESS (ISS Irregular Overpass)',
        spatialResolution: '70 m',
        temporalResolution: 'Irregular 3–5 day ISS revisit (varying solar hours)',
        processingMethod: 'Harmonized with FAO-56 Penman-Monteith reference ET0 derived from NASA POWER radiation, temperature, humidity, and wind context',
        limitations: 'ISS orbital inclination creates non-uniform overpass times; daily continuous ET0 shown in charts is model-derived from NASA POWER meteorology rather than direct 70 m ECOSTRESS thermal pixels.',
        enabled: true,
      },
      {
        id: 'grace',
        datasetName: 'NASA GRACE / GRACE-FO Terrestrial Water Storage',
        missionCode: 'GRACE-FO',
        dataSource: 'NASA JPL Mascon Tellus (Regional Aquifer & Basin Context)',
        spatialResolution: '~300 km (3° mascons)',
        temporalResolution: 'Monthly gravity anomalies',
        processingMethod: 'Explicitly flagged as coarse regional basin water context only — never interpolated as individual farm soil moisture',
        limitations: 'Spatial resolution (~300 km) reflects watershed and aquifer-scale storage anomalies; strictly unsuitable for single-farm irrigation scheduling.',
        enabled: true,
      },
      {
        id: 'gedi',
        datasetName: 'NASA GEDI Ecosystem Structure & Canopy Lidar',
        missionCode: 'GEDI',
        dataSource: 'NASA LP DAAC GEDI L2A/L2B (ISS Lidar Footprints)',
        spatialResolution: '25 m discrete footprints (600 m track spacing)',
        temporalResolution: 'Opportunistic orbital transects',
        processingMethod: 'Canopy/agroforestry structure context where orbital tracks intersect district; flagged when no direct footprint covers the polygon',
        limitations: 'Discrete laser tracks leave spatial gaps between orbits; small annual-crop plots rarely receive repeat biomass passes.',
        enabled: true,
      },
    ];
    const stmt = db.prepare(
      `INSERT INTO dataset_configs (id, dataset_name, mission_code, data_source, spatial_resolution, temporal_resolution, processing_method, limitations, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of datasets) {
      stmt.run(d.id, d.datasetName, d.missionCode, d.dataSource, d.spatialResolution, d.temporalResolution, d.processingMethod, d.limitations, d.enabled ? 1 : 0);
    }
  }

  // Seed Crop Intelligence Database (15 well-documented crops)
  const cropCount = (db.prepare(`SELECT COUNT(*) as c FROM crops`).get() as { c: number }).c;
  if (cropCount === 0) {
    const crops: Crop[] = [
      {
        id: 'maize',
        name: 'Maize',
        scientificName: 'Zea mays',
        family: 'Poaceae (Cereal Grass)',
        growingDurationDays: '95–130 days',
        waterReqMm: '500–800 mm',
        waterTier: 'High',
        tempMinC: 10,
        tempOptMinC: 20,
        tempOptMaxC: 30,
        tempMaxC: 35,
        soilPreference: 'Deep, well-drained fertile loam or sandy loam',
        phMin: 5.5,
        phMax: 7.5,
        rootingDepthCm: '90–150 cm',
        rootingType: 'Fibrous shallow-to-medium root system',
        nutrientDemand: 'Heavy',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'Moderate',
        foragePotential: 'Good stover residue for dry-season livestock feed',
        pestDiseaseNotes: 'Susceptible to Fall Armyworm, Striga hermonthica under low-N, and Maize Lethal Necrosis when grown continuously.',
        suitableSeasons: 'Major rainy season; short-duration varieties in minor rains',
        compatiblePredecessors: ['Cowpea', 'Groundnut', 'Soybean', 'Mucuna (Velvet Bean)', 'Sunn Hemp', 'Pigeon Pea'],
        incompatiblePredecessors: ['Maize', 'Sorghum', 'Pearl Millet'],
        regions: ['West Africa', 'East Africa', 'Southern Africa', 'Global Temperate/Subtropical'],
      },
      {
        id: 'cowpea',
        name: 'Cowpea',
        scientificName: 'Vigna unguiculata',
        family: 'Fabaceae (Legume)',
        growingDurationDays: '60–85 days',
        waterReqMm: '300–450 mm',
        waterTier: 'Low',
        tempMinC: 15,
        tempOptMinC: 24,
        tempOptMaxC: 34,
        tempMaxC: 40,
        soilPreference: 'Sandy loam to loam; tolerates poor soils if well-drained',
        phMin: 5.5,
        phMax: 7.0,
        rootingDepthCm: '60–110 cm',
        rootingType: 'Deep taproot with nitrogen-fixing nodules',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 55,
        organicMatterContrib: 'High',
        foragePotential: 'Dual-purpose grain and protein-rich haulms for livestock',
        pestDiseaseNotes: 'Attracts pod borers and aphids; breaks cereal Striga seedbank via suicidal germination.',
        suitableSeasons: 'Minor rainy season, late rains, or intercrop with cereals',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Pearl Millet', 'Cassava', 'Yam'],
        incompatiblePredecessors: ['Cowpea', 'Soybean', 'Groundnut'],
        regions: ['West Africa', 'East Africa', 'Sahel', 'Southern Africa'],
      },
      {
        id: 'groundnut',
        name: 'Groundnut',
        scientificName: 'Arachis hypogaea',
        family: 'Fabaceae (Legume)',
        growingDurationDays: '95–125 days',
        waterReqMm: '400–600 mm',
        waterTier: 'Moderate',
        tempMinC: 14,
        tempOptMinC: 25,
        tempOptMaxC: 32,
        tempMaxC: 37,
        soilPreference: 'Friable, well-drained sandy loam (for pod pegging)',
        phMin: 5.5,
        phMax: 7.0,
        rootingDepthCm: '60–100 cm',
        rootingType: 'Taproot with lateral nodulating roots',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 65,
        organicMatterContrib: 'Moderate',
        foragePotential: 'High-value hay/haulms after pod harvest',
        pestDiseaseNotes: 'Avoid waterlogged clay soils (aflatoxin risk during drought-to-wet shifts); rosette virus and leaf spot.',
        suitableSeasons: 'Main rainy season or early minor rains in sandy/loamy fields',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Pearl Millet', 'Rice'],
        incompatiblePredecessors: ['Groundnut', 'Soybean', 'Cowpea'],
        regions: ['West Africa', 'East Africa', 'Southern Africa', 'South Asia'],
      },
      {
        id: 'soybean',
        name: 'Soybean',
        scientificName: 'Glycine max',
        family: 'Fabaceae (Legume)',
        growingDurationDays: '95–120 days',
        waterReqMm: '450–650 mm',
        waterTier: 'Moderate',
        tempMinC: 13,
        tempOptMinC: 22,
        tempOptMaxC: 30,
        tempMaxC: 35,
        soilPreference: 'Well-drained fertile loam or clay loam',
        phMin: 6.0,
        phMax: 7.0,
        rootingDepthCm: '75–120 cm',
        rootingType: 'Taproot with high-biomass lateral roots',
        nutrientDemand: 'Moderate',
        nitrogenFixingKgHa: 85,
        organicMatterContrib: 'High',
        foragePotential: 'Moderate residue; high protein grain market',
        pestDiseaseNotes: 'Soybean rust and pod-sucking bugs; strong Striga trap crop in maize belts.',
        suitableSeasons: 'Main rainy season; requires reliable moisture at pod fill',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Rice', 'Yam'],
        incompatiblePredecessors: ['Soybean', 'Groundnut', 'Cowpea'],
        regions: ['West Africa', 'East Africa', 'Southern Africa', 'Americas'],
      },
      {
        id: 'sorghum',
        name: 'Sorghum',
        scientificName: 'Sorghum bicolor',
        family: 'Poaceae (Cereal Grass)',
        growingDurationDays: '100–130 days',
        waterReqMm: '350–550 mm',
        waterTier: 'Low',
        tempMinC: 12,
        tempOptMinC: 25,
        tempOptMaxC: 35,
        tempMaxC: 42,
        soilPreference: 'Wide tolerance from sandy loam to cracking clay',
        phMin: 5.5,
        phMax: 8.0,
        rootingDepthCm: '120–180 cm',
        rootingType: 'Deep, dense drought-tolerant fibrous roots',
        nutrientDemand: 'Moderate',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'High',
        foragePotential: 'Excellent dual-purpose grain and dry-season fodder stover',
        pestDiseaseNotes: 'Striga susceptibility when rotated continuously with cereals; midge and bird damage.',
        suitableSeasons: 'Semi-arid main rains or dry-margin transition seasons',
        compatiblePredecessors: ['Cowpea', 'Groundnut', 'Mucuna (Velvet Bean)', 'Pigeon Pea', 'Lablab Bean'],
        incompatiblePredecessors: ['Sorghum', 'Maize', 'Pearl Millet'],
        regions: ['West Africa', 'East Africa', 'Sahel', 'Southern Africa', 'South Asia'],
      },
      {
        id: 'millet',
        name: 'Pearl Millet',
        scientificName: 'Cenchrus americanus',
        family: 'Poaceae (Cereal Grass)',
        growingDurationDays: '75–100 days',
        waterReqMm: '250–450 mm',
        waterTier: 'Low',
        tempMinC: 15,
        tempOptMinC: 26,
        tempOptMaxC: 36,
        tempMaxC: 43,
        soilPreference: 'Light sandy soils with low moisture retention',
        phMin: 5.0,
        phMax: 7.5,
        rootingDepthCm: '110–160 cm',
        rootingType: 'Rapidly penetrating deep fibrous root system',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'Moderate',
        foragePotential: 'Strong dryland stover forage',
        pestDiseaseNotes: 'Downy mildew and head miner; benefits substantially from preceding cowpea or groundnut.',
        suitableSeasons: 'Short or erratic rainy seasons in semi-arid zones',
        compatiblePredecessors: ['Cowpea', 'Groundnut', 'Lablab Bean'],
        incompatiblePredecessors: ['Pearl Millet', 'Sorghum', 'Maize'],
        regions: ['Sahel', 'West Africa', 'East Africa', 'South Asia'],
      },
      {
        id: 'cassava',
        name: 'Cassava',
        scientificName: 'Manihot esculenta',
        family: 'Euphorbiaceae (Root/Tuber)',
        growingDurationDays: '240–365 days',
        waterReqMm: '500–900 mm (spread over 8–12 months)',
        waterTier: 'Low',
        tempMinC: 15,
        tempOptMinC: 25,
        tempOptMaxC: 32,
        tempMaxC: 38,
        soilPreference: 'Light-to-medium well-drained sandy loam; avoids waterlogging',
        phMin: 4.8,
        phMax: 7.0,
        rootingDepthCm: '80–130 cm',
        rootingType: 'Tuberous storage roots with deep feeder roots',
        nutrientDemand: 'Moderate',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'Moderate',
        foragePotential: 'Leaves usable as high-protein silage when processed',
        pestDiseaseNotes: 'Cassava Mosaic Disease and Brown Streak; heavy potassium exporter — follow with legume or cover crop.',
        suitableSeasons: 'Early rains; persists through dry season as food security crop',
        compatiblePredecessors: ['Mucuna (Velvet Bean)', 'Cowpea', 'Maize', 'Soybean'],
        incompatiblePredecessors: ['Cassava', 'Yam'],
        regions: ['West Africa', 'Central Africa', 'East Africa', 'Southeast Asia'],
      },
      {
        id: 'yam',
        name: 'Yam',
        scientificName: 'Dioscorea rotundata',
        family: 'Dioscoreaceae (Tuber)',
        growingDurationDays: '210–270 days',
        waterReqMm: '900–1200 mm',
        waterTier: 'High',
        tempMinC: 18,
        tempOptMinC: 25,
        tempOptMaxC: 31,
        tempMaxC: 36,
        soilPreference: 'Deep, loose, high-organic-matter loam mounds',
        phMin: 5.5,
        phMax: 7.0,
        rootingDepthCm: '50–90 cm',
        rootingType: 'Shallow-to-medium tuber mounds requiring high organic matter',
        nutrientDemand: 'Heavy',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'Low',
        foragePotential: 'Minimal; vines return minor residue',
        pestDiseaseNotes: 'Yam nematodes and anthracnose; responds very strongly to preceding Mucuna or Pigeon Pea mulch.',
        suitableSeasons: 'Humid/sub-humid main rainy season',
        compatiblePredecessors: ['Mucuna (Velvet Bean)', 'Pigeon Pea', 'Sunn Hemp', 'Cowpea'],
        incompatiblePredecessors: ['Yam', 'Cassava'],
        regions: ['West Africa', 'Central Africa'],
      },
      {
        id: 'rice',
        name: 'Rice (Upland / Bunded)',
        scientificName: 'Oryza sativa',
        family: 'Poaceae (Cereal)',
        growingDurationDays: '105–135 days',
        waterReqMm: '750–1200 mm',
        waterTier: 'High',
        tempMinC: 16,
        tempOptMinC: 24,
        tempOptMaxC: 32,
        tempMaxC: 37,
        soilPreference: 'Clay loam or valley-bottom soils with high moisture retention',
        phMin: 5.0,
        phMax: 7.2,
        rootingDepthCm: '30–60 cm',
        rootingType: 'Shallow dense fibrous root mat',
        nutrientDemand: 'Heavy',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'Moderate',
        foragePotential: 'Straw usable for livestock bedding and mulch',
        pestDiseaseNotes: 'Rice blast and stem borers; rotating with off-season cowpea or soybean breaks paddy pest cycles.',
        suitableSeasons: 'Peak wet season or irrigated lowlands',
        compatiblePredecessors: ['Cowpea', 'Soybean', 'Sunn Hemp', 'Groundnut'],
        incompatiblePredecessors: ['Rice', 'Maize'],
        regions: ['West Africa', 'East Africa', 'Asia', 'Global'],
      },
      {
        id: 'mucuna',
        name: 'Mucuna (Velvet Bean)',
        scientificName: 'Mucuna pruriens',
        family: 'Fabaceae (Cover Crop)',
        growingDurationDays: '100–140 days',
        waterReqMm: '400–650 mm',
        waterTier: 'Moderate',
        tempMinC: 15,
        tempOptMinC: 23,
        tempOptMaxC: 32,
        tempMaxC: 38,
        soilPreference: 'Adaptable across degraded sandy to clay loams',
        phMin: 5.0,
        phMax: 7.5,
        rootingDepthCm: '90–140 cm',
        rootingType: 'Vigorous spreading taproot with dense canopy',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 120,
        organicMatterContrib: 'High',
        foragePotential: 'Seed requires processing; foliage provides rich green manure & mulch',
        pestDiseaseNotes: 'Suppresses Imperata cylindrica (speargrass), Striga, and root-knot nematodes.',
        suitableSeasons: 'Minor rains or relay-cropped for soil restoration',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Cassava', 'Yam'],
        incompatiblePredecessors: ['Mucuna (Velvet Bean)'],
        regions: ['West Africa', 'East Africa', 'Southern Africa', 'Latin America'],
      },
      {
        id: 'sunn_hemp',
        name: 'Sunn Hemp',
        scientificName: 'Crotalaria juncea',
        family: 'Fabaceae (Cover Crop)',
        growingDurationDays: '60–90 days (cover termination)',
        waterReqMm: '300–500 mm',
        waterTier: 'Low',
        tempMinC: 15,
        tempOptMinC: 24,
        tempOptMaxC: 34,
        tempMaxC: 39,
        soilPreference: 'Well-drained sandy to medium loam; tolerates low fertility',
        phMin: 5.0,
        phMax: 7.5,
        rootingDepthCm: '100–150 cm',
        rootingType: 'Deep fibrous taproot with fast biomass accumulation',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 105,
        organicMatterContrib: 'High',
        foragePotential: 'Fibrous green manure and erosion-control mulch',
        pestDiseaseNotes: 'Actively suppresses root-knot nematodes before high-value crops or tubers.',
        suitableSeasons: 'Short window between main harvests or minor rains',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Yam', 'Rice'],
        incompatiblePredecessors: ['Sunn Hemp'],
        regions: ['East Africa', 'Southern Africa', 'West Africa', 'Tropics'],
      },
      {
        id: 'pigeon_pea',
        name: 'Pigeon Pea',
        scientificName: 'Cajanus cajan',
        family: 'Fabaceae (Deep-Rooted Legume)',
        growingDurationDays: '130–180 days',
        waterReqMm: '350–600 mm',
        waterTier: 'Low',
        tempMinC: 14,
        tempOptMinC: 24,
        tempOptMaxC: 33,
        tempMaxC: 39,
        soilPreference: 'Deep well-drained soils; breaks hardpans',
        phMin: 5.0,
        phMax: 7.5,
        rootingDepthCm: '150–220 cm',
        rootingType: 'Very deep biological subsoiler taproot',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 90,
        organicMatterContrib: 'High',
        foragePotential: 'High-protein leaf drop + dry-season livestock browse + firewood',
        pestDiseaseNotes: 'Pod borers at flowering; excellent drought buffer and phosphorus mobilizer.',
        suitableSeasons: 'Main rains extending into early dry season',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Pearl Millet'],
        incompatiblePredecessors: ['Pigeon Pea'],
        regions: ['East Africa', 'Southern Africa', 'West Africa', 'South Asia'],
      },
      {
        id: 'lablab',
        name: 'Lablab Bean',
        scientificName: 'Lablab purpureus',
        family: 'Fabaceae (Dual-Purpose Forage Legume)',
        growingDurationDays: '90–130 days',
        waterReqMm: '350–550 mm',
        waterTier: 'Low',
        tempMinC: 14,
        tempOptMinC: 22,
        tempOptMaxC: 32,
        tempMaxC: 38,
        soilPreference: 'Sandy loam to clay loam if not flooded',
        phMin: 5.0,
        phMax: 7.5,
        rootingDepthCm: '120–180 cm',
        rootingType: 'Deep drought-resilient taproot with dense ground cover',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 85,
        organicMatterContrib: 'High',
        foragePotential: 'Premier dry-season high-protein livestock fodder and ground cover',
        pestDiseaseNotes: 'Reduces soil erosion rapidly via dense canopy; low pest carryover to cereals.',
        suitableSeasons: 'Minor rains or intercropped after cereal tasseling',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Pearl Millet'],
        incompatiblePredecessors: ['Lablab Bean', 'Cowpea'],
        regions: ['East Africa', 'Southern Africa', 'Sahel', 'Australia'],
      },
      {
        id: 'sweet_potato',
        name: 'Sweet Potato (Orange-Fleshed)',
        scientificName: 'Ipomoea batatas',
        family: 'Convolvulaceae (Trailing Vine Tuber)',
        growingDurationDays: '100–135 days',
        waterReqMm: '400–600 mm',
        waterTier: 'Moderate',
        tempMinC: 15,
        tempOptMinC: 24,
        tempOptMaxC: 31,
        tempMaxC: 36,
        soilPreference: 'Sandy loam ridges with good drainage',
        phMin: 5.2,
        phMax: 6.8,
        rootingDepthCm: '40–75 cm',
        rootingType: 'Spreading vine with storage roots providing rapid ground cover',
        nutrientDemand: 'Moderate',
        nitrogenFixingKgHa: 0,
        organicMatterContrib: 'Moderate',
        foragePotential: 'Fresh vines provide nutritious pig and dairy fodder',
        pestDiseaseNotes: 'Sweet potato weevil during severe soil cracking; vine canopy curbs sheet erosion.',
        suitableSeasons: 'Main or minor rainy seasons on contoured ridges',
        compatiblePredecessors: ['Cowpea', 'Soybean', 'Maize', 'Sorghum'],
        incompatiblePredecessors: ['Sweet Potato (Orange-Fleshed)'],
        regions: ['East Africa', 'West Africa', 'Southern Africa', 'Global'],
      },
      {
        id: 'chickpea',
        name: 'Chickpea',
        scientificName: 'Cicer arietinum',
        family: 'Fabaceae (Cool-Residual Legume)',
        growingDurationDays: '95–120 days',
        waterReqMm: '250–400 mm',
        waterTier: 'Low',
        tempMinC: 8,
        tempOptMinC: 18,
        tempOptMaxC: 27,
        tempMaxC: 33,
        soilPreference: 'Deep black Vertisols or medium loam using residual moisture',
        phMin: 6.0,
        phMax: 8.0,
        rootingDepthCm: '90–140 cm',
        rootingType: 'Deep taproot adapted to residual post-rain soil moisture',
        nutrientDemand: 'Light',
        nitrogenFixingKgHa: 60,
        organicMatterContrib: 'Moderate',
        foragePotential: 'Residue usable for small ruminants',
        pestDiseaseNotes: 'Avoid waterlogging; Ascochyta blight in overly humid conditions.',
        suitableSeasons: 'Post-rainy residual moisture season in highland/mid-altitude Vertisols',
        compatiblePredecessors: ['Maize', 'Sorghum', 'Rice'],
        incompatiblePredecessors: ['Chickpea', 'Soybean'],
        regions: ['East African Highlands', 'South Asia', 'Mediterranean'],
      },
    ];

    const cropStmt = db.prepare(
      `INSERT INTO crops (
        id, name, scientific_name, family, growing_duration_days, water_req_mm, water_tier,
        temp_min_c, temp_opt_min_c, temp_opt_max_c, temp_max_c, soil_preference, ph_min, ph_max,
        rooting_depth_cm, rooting_type, nutrient_demand, nitrogen_fixing_kg_ha, organic_matter_contrib,
        forage_potential, pest_disease_notes, suitable_seasons, compatible_predecessors_json,
        incompatible_predecessors_json, regions_json, updated_by, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const c of crops) {
      cropStmt.run(
        c.id, c.name, c.scientificName, c.family, c.growingDurationDays, c.waterReqMm, c.waterTier,
        c.tempMinC, c.tempOptMinC, c.tempOptMaxC, c.tempMaxC, c.soilPreference, c.phMin, c.phMax,
        c.rootingDepthCm, c.rootingType, c.nutrientDemand, c.nitrogenFixingKgHa, c.organicMatterContrib,
        c.foragePotential, c.pestDiseaseNotes, c.suitableSeasons, JSON.stringify(c.compatiblePredecessors),
        JSON.stringify(c.incompatiblePredecessors), JSON.stringify(c.regions), 'system-seed', now
      );
    }
  }

  // Seed Demo Users (Admin, Expert, Researcher, Farmer)
  const userCount = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  if (userCount === 0) {
    const insertUser = db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, verified, organization, region, preferred_units, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertUser.run('user-farmer-1', 'kwame.mensah@terravane.org', 'Kwame Mensah', hashPassword('FarmerTerra2026!'), 'farmer', 1, 'Ejura Smallholder Cooperative', 'Ashanti Region, Ghana', 'metric', now);
    insertUser.run('user-expert-1', 'amina.osei@terravane.org', 'Dr. Amina Osei', hashPassword('ExpertTerra2026!'), 'expert', 1, 'West Africa Agronomy Extension', 'Kumasi, Ghana', 'metric', now);
    insertUser.run('user-researcher-1', 'david.kamau@terravane.org', 'David Kamau', hashPassword('ResearchTerra2026!'), 'researcher', 1, 'Rift Valley Agro-Climate Lab', 'Nakuru, Kenya', 'metric', now);
    insertUser.run('user-admin-1', 'admin@terravane.org', 'TerraVane Platform Admin', hashPassword('AdminTerra2026!'), 'admin', 1, 'TerraVane Operations', 'Global', 'metric', now);

    // Seed two real-coordinate sample farms for Kwame Mensah
    const insertFarm = db.prepare(
      `INSERT INTO farms (
        id, owner_id, name, country, region, district, size_hectares, farming_type,
        centroid_lat, centroid_lon, polygon_geojson, soil_type, soil_texture, drainage,
        soil_fertility, organic_matter_pct, soil_ph, irrigation_available, soil_notes,
        previous_crops_json, current_crops_json, planned_crops_json, planting_seasons,
        harvest_periods, pest_history, available_water, equipment_notes, market_preferences,
        priorities_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    insertFarm.run(
      'farm-ejura-1',
      'user-farmer-1',
      'Ejura Transition Ridge Plot',
      'Ghana',
      'Ashanti Region',
      'Ejura-Sekyedumase',
      4.8,
      'Rainfed mixed cereal-legume smallholder',
      7.3833,
      -1.3667,
      JSON.stringify([
        { lat: 7.3845, lon: -1.3680 },
        { lat: 7.3845, lon: -1.3654 },
        { lat: 7.3821, lon: -1.3654 },
        { lat: 7.3821, lon: -1.3680 },
      ]),
      'Savanna Ochrosol (Ferric Lixisol)',
      'Sandy Loam',
      'Well-drained',
      'Moderate (declining nitrogen after 3 maize seasons)',
      1.6,
      5.9,
      'Rainfed only (seasonal stream nearby, no pump)',
      'Upper terrace dries quickly after 8+ days without rain.',
      JSON.stringify(['Maize', 'Maize', 'Maize']),
      JSON.stringify(['Maize']),
      JSON.stringify(['Cowpea', 'Soybean']),
      'Major rains (April–July) and minor rains (September–November)',
      'August and December',
      'Recurring Fall Armyworm pressure and early Striga patches on north corner',
      'Rainfed; dry spells common in August and November',
      'Hand hoe, knapsack sprayer, shared tractor plowing at start of major rains',
      'Strong regional grain market for maize, cowpea, and soybean at Ejura market',
      JSON.stringify([
        'Improving soil health',
        'Conserving water',
        'Improving nutrient cycling',
        'Reducing pest pressure',
        'Adapting to changing rainfall',
        'Market suitability',
      ]),
      now,
      now
    );

    insertFarm.run(
      'farm-tamale-2',
      'user-farmer-1',
      'Savelugu Northern Valley Block',
      'Ghana',
      'Northern Region',
      'Savelugu',
      3.2,
      'Rainfed savanna crop-livestock farm',
      9.6244,
      -0.8253,
      JSON.stringify([
        { lat: 9.6255, lon: -0.8266 },
        { lat: 9.6255, lon: -0.8240 },
        { lat: 9.6233, lon: -0.8240 },
        { lat: 9.6233, lon: -0.8266 },
      ]),
      'Plinthosol / Savanna Sandy Loam',
      'Loamy Sand',
      'Moderately well-drained',
      'Unknown',
      null,
      null,
      'None (strictly rainfed)',
      'Laboratory soil test not yet conducted.',
      JSON.stringify(['Sorghum', 'Maize']),
      JSON.stringify(['Sorghum']),
      JSON.stringify(['Groundnut']),
      'Single unimodal rainy season (May–October)',
      'October–November',
      'Striga emergence and dry-season fodder shortage for cattle',
      'Unimodal rainfall only',
      'Animal traction ridger and manual weeding',
      'Groundnut and dual-purpose sorghum stover valued locally',
      JSON.stringify([
        'Improving forage availability',
        'Reducing heat-related crop vulnerability',
        'Reducing erosion',
        'Increasing organic matter',
      ]),
      now,
      now
    );
  }

  // Seed initial platform announcement
  const annCount = (db.prepare(`SELECT COUNT(*) as c FROM announcements`).get() as { c: number }).c;
  if (annCount === 0) {
    db.prepare(
      `INSERT INTO announcements (id, title, body, severity, active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'ann-1',
      'NASA POWER & GIBS Satellite Harmonisation Active',
      'Daily precipitation, 2m temperature, root-zone soil wetness, and SRTM terrain elevation are live-queried for registered farm coordinates. Remember that gridded 0.5° meteorology complements—never replaces—on-farm soil testing.',
      'info',
      1,
      'TerraVane Platform Admin',
      now
    );
  }
}
