// server.ts
import "dotenv/config";
import express from "express";
import crypto2 from "node:crypto";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

// server/db.ts
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
var dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
var db = new Database(path.join(dataDir, "terravane.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}
function initDatabase() {
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
function writeAuditLog(userId, userEmail, action, resourceType, resourceId, details, ip = "local") {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, user_email, action, resource_type, resource_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), userId, userEmail, action, resourceType, resourceId, details, ip, (/* @__PURE__ */ new Date()).toISOString());
}
function seedInitialData() {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existingAi = db.prepare(`SELECT id FROM ai_settings WHERE id = 'default'`).get();
  if (!existingAi) {
    db.prepare(
      `INSERT INTO ai_settings (id, model_name, system_tone, strict_scientific_disclaimer, max_history_turns, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("default", "gemini-4-hydrogen", "Practical, respectful agronomic advisor grounded in empirical observation", 1, 12, now);
  }
  const datasetCount = db.prepare(`SELECT COUNT(*) as c FROM dataset_configs`).get().c;
  if (datasetCount === 0) {
    const datasets = [
      {
        id: "power",
        datasetName: "NASA POWER Agroclimatology Daily & Monthly",
        missionCode: "POWER",
        dataSource: "NASA Langley Research Center (POWER API v2 / MERRA-2 & CERES)",
        spatialResolution: "0.5\xB0 \xD7 0.625\xB0 (~55 km grid)",
        temporalResolution: "Daily & Monthly (4\u20137 day operational latency)",
        processingMethod: "Live API query for farm centroid with missing-value (-999) filtering and FAO-56 Penman-Monteith ET0 harmonization",
        limitations: "Gridded regional meteorology (~55 km); localized convective storms, microclimate shade, and field-level irrigation are not resolved.",
        enabled: true
      },
      {
        id: "gpm",
        datasetName: "NASA GPM IMERG Precipitation Context",
        missionCode: "GPM",
        dataSource: "NASA Goddard Earth Sciences (GPM IMERG / POWER PRECTOTCORR)",
        spatialResolution: "0.1\xB0 (~11 km native IMERG) / 0.5\xB0 harmonized",
        temporalResolution: "30-minute native / Daily aggregated rainfall",
        processingMethod: "Bias-adjusted satellite precipitation accumulation, dry-spell streak (>10d <1mm) and extreme rain (>30mm/d) indexing",
        limitations: "Satellite rainfall estimates can under- or over-estimate intense localized tropical squalls compared with an on-farm rain gauge.",
        enabled: true
      },
      {
        id: "smap",
        datasetName: "NASA SMAP Root-Zone & Surface Soil Moisture",
        missionCode: "SMAP",
        dataSource: "NASA NSIDC SMAP L4 / GEOS-5 Assimilated Wetness (GWETTOP & GWETROOT)",
        spatialResolution: "9 km (SMAP L4) / 0.5\xB0 surface-root wetness index",
        temporalResolution: "Daily assimilated 0\u20135 cm & 0\u2013100 cm profile",
        processingMethod: "Dimensionless soil wetness (0\u20131) compared against multi-year monthly seasonal baseline anomalies",
        limitations: "Measures regional top-layer and assimilated root-zone wetness across multi-kilometer footprints; does not measure exact field-plot volumetric moisture or soil organic carbon.",
        enabled: true
      },
      {
        id: "srtm",
        datasetName: "NASA SRTM / Copernicus Digital Elevation Model",
        missionCode: "SRTM",
        dataSource: "NASA Shuttle Radar Topography Mission / 30m-90m DEM via Open-Meteo Elevation API",
        spatialResolution: "30 m \u2013 90 m",
        temporalResolution: "Static baseline terrain surface",
        processingMethod: "Multi-point elevation sampling across farm centroid and boundary offsets to estimate slope gradient (%) and runoff exposure",
        limitations: "Does not capture recent micro-terracing, bunds, or seasonal tillage ridges built after DEM acquisition.",
        enabled: true
      },
      {
        id: "modis",
        datasetName: "NASA MODIS Terra 8-Day Vegetation & Thermal Context",
        missionCode: "MODIS",
        dataSource: "NASA LP DAAC / GIBS WMTS (MOD13Q1 / MOD09Q1 / MOD11A2)",
        spatialResolution: "250 m (NDVI) \u2013 1 km (LST)",
        temporalResolution: "8-day / 16-day composite",
        processingMethod: "Tiled WMTS orbital overlay in Leaflet map; paired with agroclimatic water-balance vegetation stress proxy",
        limitations: "250 m pixels frequently mix multiple smallholder plots, hedgerows, and fallow patches; cloud cover during wet seasons limits optical retrieval.",
        enabled: true
      },
      {
        id: "landsat",
        datasetName: "NASA/USGS Landsat 8\u20139 Optical Land Cover Context",
        missionCode: "LANDSAT",
        dataSource: "USGS / NASA Landsat Collection 2 (GIBS / STAC Metadata)",
        spatialResolution: "30 m",
        temporalResolution: "8\u201316 day revisit (cloud-dependent)",
        processingMethod: "30 m field-boundary visual context; optical vegetation interpretation requires cloud-free local overpass verification",
        limitations: "Persistent wet-season cloud cover in West and East Africa often creates multi-week gaps during peak crop establishment.",
        enabled: true
      },
      {
        id: "ecostress",
        datasetName: "NASA ECOSTRESS Evapotranspiration & Thermal Stress",
        missionCode: "ECOSTRESS",
        dataSource: "NASA JPL ECOSTRESS (ISS Irregular Overpass)",
        spatialResolution: "70 m",
        temporalResolution: "Irregular 3\u20135 day ISS revisit (varying solar hours)",
        processingMethod: "Harmonized with FAO-56 Penman-Monteith reference ET0 derived from NASA POWER radiation, temperature, humidity, and wind context",
        limitations: "ISS orbital inclination creates non-uniform overpass times; daily continuous ET0 shown in charts is model-derived from NASA POWER meteorology rather than direct 70 m ECOSTRESS thermal pixels.",
        enabled: true
      },
      {
        id: "grace",
        datasetName: "NASA GRACE / GRACE-FO Terrestrial Water Storage",
        missionCode: "GRACE-FO",
        dataSource: "NASA JPL Mascon Tellus (Regional Aquifer & Basin Context)",
        spatialResolution: "~300 km (3\xB0 mascons)",
        temporalResolution: "Monthly gravity anomalies",
        processingMethod: "Explicitly flagged as coarse regional basin water context only \u2014 never interpolated as individual farm soil moisture",
        limitations: "Spatial resolution (~300 km) reflects watershed and aquifer-scale storage anomalies; strictly unsuitable for single-farm irrigation scheduling.",
        enabled: true
      },
      {
        id: "gedi",
        datasetName: "NASA GEDI Ecosystem Structure & Canopy Lidar",
        missionCode: "GEDI",
        dataSource: "NASA LP DAAC GEDI L2A/L2B (ISS Lidar Footprints)",
        spatialResolution: "25 m discrete footprints (600 m track spacing)",
        temporalResolution: "Opportunistic orbital transects",
        processingMethod: "Canopy/agroforestry structure context where orbital tracks intersect district; flagged when no direct footprint covers the polygon",
        limitations: "Discrete laser tracks leave spatial gaps between orbits; small annual-crop plots rarely receive repeat biomass passes.",
        enabled: true
      }
    ];
    const stmt = db.prepare(
      `INSERT INTO dataset_configs (id, dataset_name, mission_code, data_source, spatial_resolution, temporal_resolution, processing_method, limitations, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const d of datasets) {
      stmt.run(d.id, d.datasetName, d.missionCode, d.dataSource, d.spatialResolution, d.temporalResolution, d.processingMethod, d.limitations, d.enabled ? 1 : 0);
    }
  }
  const cropCount = db.prepare(`SELECT COUNT(*) as c FROM crops`).get().c;
  if (cropCount === 0) {
    const crops = [
      {
        id: "maize",
        name: "Maize",
        scientificName: "Zea mays",
        family: "Poaceae (Cereal Grass)",
        growingDurationDays: "95\u2013130 days",
        waterReqMm: "500\u2013800 mm",
        waterTier: "High",
        tempMinC: 10,
        tempOptMinC: 20,
        tempOptMaxC: 30,
        tempMaxC: 35,
        soilPreference: "Deep, well-drained fertile loam or sandy loam",
        phMin: 5.5,
        phMax: 7.5,
        rootingDepthCm: "90\u2013150 cm",
        rootingType: "Fibrous shallow-to-medium root system",
        nutrientDemand: "Heavy",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "Moderate",
        foragePotential: "Good stover residue for dry-season livestock feed",
        pestDiseaseNotes: "Susceptible to Fall Armyworm, Striga hermonthica under low-N, and Maize Lethal Necrosis when grown continuously.",
        suitableSeasons: "Major rainy season; short-duration varieties in minor rains",
        compatiblePredecessors: ["Cowpea", "Groundnut", "Soybean", "Mucuna (Velvet Bean)", "Sunn Hemp", "Pigeon Pea"],
        incompatiblePredecessors: ["Maize", "Sorghum", "Pearl Millet"],
        regions: ["West Africa", "East Africa", "Southern Africa", "Global Temperate/Subtropical"]
      },
      {
        id: "cowpea",
        name: "Cowpea",
        scientificName: "Vigna unguiculata",
        family: "Fabaceae (Legume)",
        growingDurationDays: "60\u201385 days",
        waterReqMm: "300\u2013450 mm",
        waterTier: "Low",
        tempMinC: 15,
        tempOptMinC: 24,
        tempOptMaxC: 34,
        tempMaxC: 40,
        soilPreference: "Sandy loam to loam; tolerates poor soils if well-drained",
        phMin: 5.5,
        phMax: 7,
        rootingDepthCm: "60\u2013110 cm",
        rootingType: "Deep taproot with nitrogen-fixing nodules",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 55,
        organicMatterContrib: "High",
        foragePotential: "Dual-purpose grain and protein-rich haulms for livestock",
        pestDiseaseNotes: "Attracts pod borers and aphids; breaks cereal Striga seedbank via suicidal germination.",
        suitableSeasons: "Minor rainy season, late rains, or intercrop with cereals",
        compatiblePredecessors: ["Maize", "Sorghum", "Pearl Millet", "Cassava", "Yam"],
        incompatiblePredecessors: ["Cowpea", "Soybean", "Groundnut"],
        regions: ["West Africa", "East Africa", "Sahel", "Southern Africa"]
      },
      {
        id: "groundnut",
        name: "Groundnut",
        scientificName: "Arachis hypogaea",
        family: "Fabaceae (Legume)",
        growingDurationDays: "95\u2013125 days",
        waterReqMm: "400\u2013600 mm",
        waterTier: "Moderate",
        tempMinC: 14,
        tempOptMinC: 25,
        tempOptMaxC: 32,
        tempMaxC: 37,
        soilPreference: "Friable, well-drained sandy loam (for pod pegging)",
        phMin: 5.5,
        phMax: 7,
        rootingDepthCm: "60\u2013100 cm",
        rootingType: "Taproot with lateral nodulating roots",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 65,
        organicMatterContrib: "Moderate",
        foragePotential: "High-value hay/haulms after pod harvest",
        pestDiseaseNotes: "Avoid waterlogged clay soils (aflatoxin risk during drought-to-wet shifts); rosette virus and leaf spot.",
        suitableSeasons: "Main rainy season or early minor rains in sandy/loamy fields",
        compatiblePredecessors: ["Maize", "Sorghum", "Pearl Millet", "Rice"],
        incompatiblePredecessors: ["Groundnut", "Soybean", "Cowpea"],
        regions: ["West Africa", "East Africa", "Southern Africa", "South Asia"]
      },
      {
        id: "soybean",
        name: "Soybean",
        scientificName: "Glycine max",
        family: "Fabaceae (Legume)",
        growingDurationDays: "95\u2013120 days",
        waterReqMm: "450\u2013650 mm",
        waterTier: "Moderate",
        tempMinC: 13,
        tempOptMinC: 22,
        tempOptMaxC: 30,
        tempMaxC: 35,
        soilPreference: "Well-drained fertile loam or clay loam",
        phMin: 6,
        phMax: 7,
        rootingDepthCm: "75\u2013120 cm",
        rootingType: "Taproot with high-biomass lateral roots",
        nutrientDemand: "Moderate",
        nitrogenFixingKgHa: 85,
        organicMatterContrib: "High",
        foragePotential: "Moderate residue; high protein grain market",
        pestDiseaseNotes: "Soybean rust and pod-sucking bugs; strong Striga trap crop in maize belts.",
        suitableSeasons: "Main rainy season; requires reliable moisture at pod fill",
        compatiblePredecessors: ["Maize", "Sorghum", "Rice", "Yam"],
        incompatiblePredecessors: ["Soybean", "Groundnut", "Cowpea"],
        regions: ["West Africa", "East Africa", "Southern Africa", "Americas"]
      },
      {
        id: "sorghum",
        name: "Sorghum",
        scientificName: "Sorghum bicolor",
        family: "Poaceae (Cereal Grass)",
        growingDurationDays: "100\u2013130 days",
        waterReqMm: "350\u2013550 mm",
        waterTier: "Low",
        tempMinC: 12,
        tempOptMinC: 25,
        tempOptMaxC: 35,
        tempMaxC: 42,
        soilPreference: "Wide tolerance from sandy loam to cracking clay",
        phMin: 5.5,
        phMax: 8,
        rootingDepthCm: "120\u2013180 cm",
        rootingType: "Deep, dense drought-tolerant fibrous roots",
        nutrientDemand: "Moderate",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "High",
        foragePotential: "Excellent dual-purpose grain and dry-season fodder stover",
        pestDiseaseNotes: "Striga susceptibility when rotated continuously with cereals; midge and bird damage.",
        suitableSeasons: "Semi-arid main rains or dry-margin transition seasons",
        compatiblePredecessors: ["Cowpea", "Groundnut", "Mucuna (Velvet Bean)", "Pigeon Pea", "Lablab Bean"],
        incompatiblePredecessors: ["Sorghum", "Maize", "Pearl Millet"],
        regions: ["West Africa", "East Africa", "Sahel", "Southern Africa", "South Asia"]
      },
      {
        id: "millet",
        name: "Pearl Millet",
        scientificName: "Cenchrus americanus",
        family: "Poaceae (Cereal Grass)",
        growingDurationDays: "75\u2013100 days",
        waterReqMm: "250\u2013450 mm",
        waterTier: "Low",
        tempMinC: 15,
        tempOptMinC: 26,
        tempOptMaxC: 36,
        tempMaxC: 43,
        soilPreference: "Light sandy soils with low moisture retention",
        phMin: 5,
        phMax: 7.5,
        rootingDepthCm: "110\u2013160 cm",
        rootingType: "Rapidly penetrating deep fibrous root system",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "Moderate",
        foragePotential: "Strong dryland stover forage",
        pestDiseaseNotes: "Downy mildew and head miner; benefits substantially from preceding cowpea or groundnut.",
        suitableSeasons: "Short or erratic rainy seasons in semi-arid zones",
        compatiblePredecessors: ["Cowpea", "Groundnut", "Lablab Bean"],
        incompatiblePredecessors: ["Pearl Millet", "Sorghum", "Maize"],
        regions: ["Sahel", "West Africa", "East Africa", "South Asia"]
      },
      {
        id: "cassava",
        name: "Cassava",
        scientificName: "Manihot esculenta",
        family: "Euphorbiaceae (Root/Tuber)",
        growingDurationDays: "240\u2013365 days",
        waterReqMm: "500\u2013900 mm (spread over 8\u201312 months)",
        waterTier: "Low",
        tempMinC: 15,
        tempOptMinC: 25,
        tempOptMaxC: 32,
        tempMaxC: 38,
        soilPreference: "Light-to-medium well-drained sandy loam; avoids waterlogging",
        phMin: 4.8,
        phMax: 7,
        rootingDepthCm: "80\u2013130 cm",
        rootingType: "Tuberous storage roots with deep feeder roots",
        nutrientDemand: "Moderate",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "Moderate",
        foragePotential: "Leaves usable as high-protein silage when processed",
        pestDiseaseNotes: "Cassava Mosaic Disease and Brown Streak; heavy potassium exporter \u2014 follow with legume or cover crop.",
        suitableSeasons: "Early rains; persists through dry season as food security crop",
        compatiblePredecessors: ["Mucuna (Velvet Bean)", "Cowpea", "Maize", "Soybean"],
        incompatiblePredecessors: ["Cassava", "Yam"],
        regions: ["West Africa", "Central Africa", "East Africa", "Southeast Asia"]
      },
      {
        id: "yam",
        name: "Yam",
        scientificName: "Dioscorea rotundata",
        family: "Dioscoreaceae (Tuber)",
        growingDurationDays: "210\u2013270 days",
        waterReqMm: "900\u20131200 mm",
        waterTier: "High",
        tempMinC: 18,
        tempOptMinC: 25,
        tempOptMaxC: 31,
        tempMaxC: 36,
        soilPreference: "Deep, loose, high-organic-matter loam mounds",
        phMin: 5.5,
        phMax: 7,
        rootingDepthCm: "50\u201390 cm",
        rootingType: "Shallow-to-medium tuber mounds requiring high organic matter",
        nutrientDemand: "Heavy",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "Low",
        foragePotential: "Minimal; vines return minor residue",
        pestDiseaseNotes: "Yam nematodes and anthracnose; responds very strongly to preceding Mucuna or Pigeon Pea mulch.",
        suitableSeasons: "Humid/sub-humid main rainy season",
        compatiblePredecessors: ["Mucuna (Velvet Bean)", "Pigeon Pea", "Sunn Hemp", "Cowpea"],
        incompatiblePredecessors: ["Yam", "Cassava"],
        regions: ["West Africa", "Central Africa"]
      },
      {
        id: "rice",
        name: "Rice (Upland / Bunded)",
        scientificName: "Oryza sativa",
        family: "Poaceae (Cereal)",
        growingDurationDays: "105\u2013135 days",
        waterReqMm: "750\u20131200 mm",
        waterTier: "High",
        tempMinC: 16,
        tempOptMinC: 24,
        tempOptMaxC: 32,
        tempMaxC: 37,
        soilPreference: "Clay loam or valley-bottom soils with high moisture retention",
        phMin: 5,
        phMax: 7.2,
        rootingDepthCm: "30\u201360 cm",
        rootingType: "Shallow dense fibrous root mat",
        nutrientDemand: "Heavy",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "Moderate",
        foragePotential: "Straw usable for livestock bedding and mulch",
        pestDiseaseNotes: "Rice blast and stem borers; rotating with off-season cowpea or soybean breaks paddy pest cycles.",
        suitableSeasons: "Peak wet season or irrigated lowlands",
        compatiblePredecessors: ["Cowpea", "Soybean", "Sunn Hemp", "Groundnut"],
        incompatiblePredecessors: ["Rice", "Maize"],
        regions: ["West Africa", "East Africa", "Asia", "Global"]
      },
      {
        id: "mucuna",
        name: "Mucuna (Velvet Bean)",
        scientificName: "Mucuna pruriens",
        family: "Fabaceae (Cover Crop)",
        growingDurationDays: "100\u2013140 days",
        waterReqMm: "400\u2013650 mm",
        waterTier: "Moderate",
        tempMinC: 15,
        tempOptMinC: 23,
        tempOptMaxC: 32,
        tempMaxC: 38,
        soilPreference: "Adaptable across degraded sandy to clay loams",
        phMin: 5,
        phMax: 7.5,
        rootingDepthCm: "90\u2013140 cm",
        rootingType: "Vigorous spreading taproot with dense canopy",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 120,
        organicMatterContrib: "High",
        foragePotential: "Seed requires processing; foliage provides rich green manure & mulch",
        pestDiseaseNotes: "Suppresses Imperata cylindrica (speargrass), Striga, and root-knot nematodes.",
        suitableSeasons: "Minor rains or relay-cropped for soil restoration",
        compatiblePredecessors: ["Maize", "Sorghum", "Cassava", "Yam"],
        incompatiblePredecessors: ["Mucuna (Velvet Bean)"],
        regions: ["West Africa", "East Africa", "Southern Africa", "Latin America"]
      },
      {
        id: "sunn_hemp",
        name: "Sunn Hemp",
        scientificName: "Crotalaria juncea",
        family: "Fabaceae (Cover Crop)",
        growingDurationDays: "60\u201390 days (cover termination)",
        waterReqMm: "300\u2013500 mm",
        waterTier: "Low",
        tempMinC: 15,
        tempOptMinC: 24,
        tempOptMaxC: 34,
        tempMaxC: 39,
        soilPreference: "Well-drained sandy to medium loam; tolerates low fertility",
        phMin: 5,
        phMax: 7.5,
        rootingDepthCm: "100\u2013150 cm",
        rootingType: "Deep fibrous taproot with fast biomass accumulation",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 105,
        organicMatterContrib: "High",
        foragePotential: "Fibrous green manure and erosion-control mulch",
        pestDiseaseNotes: "Actively suppresses root-knot nematodes before high-value crops or tubers.",
        suitableSeasons: "Short window between main harvests or minor rains",
        compatiblePredecessors: ["Maize", "Sorghum", "Yam", "Rice"],
        incompatiblePredecessors: ["Sunn Hemp"],
        regions: ["East Africa", "Southern Africa", "West Africa", "Tropics"]
      },
      {
        id: "pigeon_pea",
        name: "Pigeon Pea",
        scientificName: "Cajanus cajan",
        family: "Fabaceae (Deep-Rooted Legume)",
        growingDurationDays: "130\u2013180 days",
        waterReqMm: "350\u2013600 mm",
        waterTier: "Low",
        tempMinC: 14,
        tempOptMinC: 24,
        tempOptMaxC: 33,
        tempMaxC: 39,
        soilPreference: "Deep well-drained soils; breaks hardpans",
        phMin: 5,
        phMax: 7.5,
        rootingDepthCm: "150\u2013220 cm",
        rootingType: "Very deep biological subsoiler taproot",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 90,
        organicMatterContrib: "High",
        foragePotential: "High-protein leaf drop + dry-season livestock browse + firewood",
        pestDiseaseNotes: "Pod borers at flowering; excellent drought buffer and phosphorus mobilizer.",
        suitableSeasons: "Main rains extending into early dry season",
        compatiblePredecessors: ["Maize", "Sorghum", "Pearl Millet"],
        incompatiblePredecessors: ["Pigeon Pea"],
        regions: ["East Africa", "Southern Africa", "West Africa", "South Asia"]
      },
      {
        id: "lablab",
        name: "Lablab Bean",
        scientificName: "Lablab purpureus",
        family: "Fabaceae (Dual-Purpose Forage Legume)",
        growingDurationDays: "90\u2013130 days",
        waterReqMm: "350\u2013550 mm",
        waterTier: "Low",
        tempMinC: 14,
        tempOptMinC: 22,
        tempOptMaxC: 32,
        tempMaxC: 38,
        soilPreference: "Sandy loam to clay loam if not flooded",
        phMin: 5,
        phMax: 7.5,
        rootingDepthCm: "120\u2013180 cm",
        rootingType: "Deep drought-resilient taproot with dense ground cover",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 85,
        organicMatterContrib: "High",
        foragePotential: "Premier dry-season high-protein livestock fodder and ground cover",
        pestDiseaseNotes: "Reduces soil erosion rapidly via dense canopy; low pest carryover to cereals.",
        suitableSeasons: "Minor rains or intercropped after cereal tasseling",
        compatiblePredecessors: ["Maize", "Sorghum", "Pearl Millet"],
        incompatiblePredecessors: ["Lablab Bean", "Cowpea"],
        regions: ["East Africa", "Southern Africa", "Sahel", "Australia"]
      },
      {
        id: "sweet_potato",
        name: "Sweet Potato (Orange-Fleshed)",
        scientificName: "Ipomoea batatas",
        family: "Convolvulaceae (Trailing Vine Tuber)",
        growingDurationDays: "100\u2013135 days",
        waterReqMm: "400\u2013600 mm",
        waterTier: "Moderate",
        tempMinC: 15,
        tempOptMinC: 24,
        tempOptMaxC: 31,
        tempMaxC: 36,
        soilPreference: "Sandy loam ridges with good drainage",
        phMin: 5.2,
        phMax: 6.8,
        rootingDepthCm: "40\u201375 cm",
        rootingType: "Spreading vine with storage roots providing rapid ground cover",
        nutrientDemand: "Moderate",
        nitrogenFixingKgHa: 0,
        organicMatterContrib: "Moderate",
        foragePotential: "Fresh vines provide nutritious pig and dairy fodder",
        pestDiseaseNotes: "Sweet potato weevil during severe soil cracking; vine canopy curbs sheet erosion.",
        suitableSeasons: "Main or minor rainy seasons on contoured ridges",
        compatiblePredecessors: ["Cowpea", "Soybean", "Maize", "Sorghum"],
        incompatiblePredecessors: ["Sweet Potato (Orange-Fleshed)"],
        regions: ["East Africa", "West Africa", "Southern Africa", "Global"]
      },
      {
        id: "chickpea",
        name: "Chickpea",
        scientificName: "Cicer arietinum",
        family: "Fabaceae (Cool-Residual Legume)",
        growingDurationDays: "95\u2013120 days",
        waterReqMm: "250\u2013400 mm",
        waterTier: "Low",
        tempMinC: 8,
        tempOptMinC: 18,
        tempOptMaxC: 27,
        tempMaxC: 33,
        soilPreference: "Deep black Vertisols or medium loam using residual moisture",
        phMin: 6,
        phMax: 8,
        rootingDepthCm: "90\u2013140 cm",
        rootingType: "Deep taproot adapted to residual post-rain soil moisture",
        nutrientDemand: "Light",
        nitrogenFixingKgHa: 60,
        organicMatterContrib: "Moderate",
        foragePotential: "Residue usable for small ruminants",
        pestDiseaseNotes: "Avoid waterlogging; Ascochyta blight in overly humid conditions.",
        suitableSeasons: "Post-rainy residual moisture season in highland/mid-altitude Vertisols",
        compatiblePredecessors: ["Maize", "Sorghum", "Rice"],
        incompatiblePredecessors: ["Chickpea", "Soybean"],
        regions: ["East African Highlands", "South Asia", "Mediterranean"]
      }
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
        c.id,
        c.name,
        c.scientificName,
        c.family,
        c.growingDurationDays,
        c.waterReqMm,
        c.waterTier,
        c.tempMinC,
        c.tempOptMinC,
        c.tempOptMaxC,
        c.tempMaxC,
        c.soilPreference,
        c.phMin,
        c.phMax,
        c.rootingDepthCm,
        c.rootingType,
        c.nutrientDemand,
        c.nitrogenFixingKgHa,
        c.organicMatterContrib,
        c.foragePotential,
        c.pestDiseaseNotes,
        c.suitableSeasons,
        JSON.stringify(c.compatiblePredecessors),
        JSON.stringify(c.incompatiblePredecessors),
        JSON.stringify(c.regions),
        "system-seed",
        now
      );
    }
  }
  const userCount = db.prepare(`SELECT COUNT(*) as c FROM users`).get().c;
  if (userCount === 0) {
    const insertUser = db.prepare(
      `INSERT INTO users (id, email, name, password_hash, role, verified, organization, region, preferred_units, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertUser.run("user-farmer-1", "kwame.mensah@farmnova.ai", "Kwame Mensah", hashPassword("FarmerTerra2026!"), "farmer", 1, "Ejura Smallholder Cooperative", "Ashanti Region, Ghana", "metric", now);
    insertUser.run("user-expert-1", "amina.osei@farmnova.ai", "Dr. Amina Osei", hashPassword("ExpertTerra2026!"), "expert", 1, "West Africa Agronomy Extension", "Kumasi, Ghana", "metric", now);
    insertUser.run("user-researcher-1", "david.kamau@farmnova.ai", "David Kamau", hashPassword("ResearchTerra2026!"), "researcher", 1, "Rift Valley Agro-Climate Lab", "Nakuru, Kenya", "metric", now);
    insertUser.run("user-admin-1", "admin@farmnova.ai", "FarmNova AI Platform Admin", hashPassword("AdminTerra2026!"), "admin", 1, "FarmNova AI Operations", "Global", "metric", now);
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
      "farm-ejura-1",
      "user-farmer-1",
      "Ejura Transition Ridge Plot",
      "Ghana",
      "Ashanti Region",
      "Ejura-Sekyedumase",
      4.8,
      "Rainfed mixed cereal-legume smallholder",
      7.3833,
      -1.3667,
      JSON.stringify([
        { lat: 7.3845, lon: -1.368 },
        { lat: 7.3845, lon: -1.3654 },
        { lat: 7.3821, lon: -1.3654 },
        { lat: 7.3821, lon: -1.368 }
      ]),
      "Savanna Ochrosol (Ferric Lixisol)",
      "Sandy Loam",
      "Well-drained",
      "Moderate (declining nitrogen after 3 maize seasons)",
      1.6,
      5.9,
      "Rainfed only (seasonal stream nearby, no pump)",
      "Upper terrace dries quickly after 8+ days without rain.",
      JSON.stringify(["Maize", "Maize", "Maize"]),
      JSON.stringify(["Maize"]),
      JSON.stringify(["Cowpea", "Soybean"]),
      "Major rains (April\u2013July) and minor rains (September\u2013November)",
      "August and December",
      "Recurring Fall Armyworm pressure and early Striga patches on north corner",
      "Rainfed; dry spells common in August and November",
      "Hand hoe, knapsack sprayer, shared tractor plowing at start of major rains",
      "Strong regional grain market for maize, cowpea, and soybean at Ejura market",
      JSON.stringify([
        "Improving soil health",
        "Conserving water",
        "Improving nutrient cycling",
        "Reducing pest pressure",
        "Adapting to changing rainfall",
        "Market suitability"
      ]),
      now,
      now
    );
    insertFarm.run(
      "farm-tamale-2",
      "user-farmer-1",
      "Savelugu Northern Valley Block",
      "Ghana",
      "Northern Region",
      "Savelugu",
      3.2,
      "Rainfed savanna crop-livestock farm",
      9.6244,
      -0.8253,
      JSON.stringify([
        { lat: 9.6255, lon: -0.8266 },
        { lat: 9.6255, lon: -0.824 },
        { lat: 9.6233, lon: -0.824 },
        { lat: 9.6233, lon: -0.8266 }
      ]),
      "Plinthosol / Savanna Sandy Loam",
      "Loamy Sand",
      "Moderately well-drained",
      "Unknown",
      null,
      null,
      "None (strictly rainfed)",
      "Laboratory soil test not yet conducted.",
      JSON.stringify(["Sorghum", "Maize"]),
      JSON.stringify(["Sorghum"]),
      JSON.stringify(["Groundnut"]),
      "Single unimodal rainy season (May\u2013October)",
      "October\u2013November",
      "Striga emergence and dry-season fodder shortage for cattle",
      "Unimodal rainfall only",
      "Animal traction ridger and manual weeding",
      "Groundnut and dual-purpose sorghum stover valued locally",
      JSON.stringify([
        "Improving forage availability",
        "Reducing heat-related crop vulnerability",
        "Reducing erosion",
        "Increasing organic matter"
      ]),
      now,
      now
    );
  }
  const annCount = db.prepare(`SELECT COUNT(*) as c FROM announcements`).get().c;
  if (annCount === 0) {
    db.prepare(
      `INSERT INTO announcements (id, title, body, severity, active, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "ann-1",
      "NASA POWER & GIBS Satellite Harmonisation Active",
      "Daily precipitation, 2m temperature, root-zone soil wetness, and SRTM terrain elevation are live-queried for registered farm coordinates. Remember that gridded 0.5\xB0 meteorology complements\u2014never replaces\u2014on-farm soil testing.",
      "info",
      1,
      "FarmNova AI Platform Admin",
      now
    );
  }
  db.prepare(
    `UPDATE users SET email = REPLACE(email, '@terravane.org', '@farmnova.ai'), name = REPLACE(name, 'TerraVane', 'FarmNova AI'), organization = REPLACE(organization, 'TerraVane', 'FarmNova AI') WHERE email LIKE '%@terravane.org'`
  ).run();
  db.prepare(
    `UPDATE announcements SET created_by = 'FarmNova AI Platform Admin' WHERE created_by = 'TerraVane Platform Admin'`
  ).run();
}

// server/nasa.ts
function formatYyyymmdd(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
function formatIsoDate(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}
function cleanVal(v) {
  if (v === void 0 || v === null || Number.isNaN(v) || v <= -900) return null;
  return Number(v.toFixed(3));
}
function estimateDailyEt0(tMean, tMax, tMin, rsMj, rh, elevM) {
  if (tMean === null || rsMj === null) return null;
  const tmax = tMax ?? tMean + 4;
  const tmin = tMin ?? tMean - 4;
  const rhVal = rh ?? 65;
  const es = 0.5 * (0.6108 * Math.exp(17.27 * tmax / (tmax + 237.3)) + 0.6108 * Math.exp(17.27 * tmin / (tmin + 237.3)));
  const ea = es * (Math.min(100, Math.max(10, rhVal)) / 100);
  const vpd = Math.max(0.05, es - ea);
  const delta = 4098 * (0.6108 * Math.exp(17.27 * tMean / (tMean + 237.3))) / Math.pow(tMean + 237.3, 2);
  const pressure = 101.3 * Math.pow((293 - 65e-4 * elevM) / 293, 5.26);
  const gamma = 665e-6 * pressure;
  const rn = 0.77 * rsMj - 1.8;
  const u2 = 1.8;
  const num = 0.408 * delta * Math.max(0, rn) + gamma * (900 / (tMean + 273)) * u2 * vpd;
  const den = delta + gamma * (1 + 0.34 * u2);
  const et0 = Math.max(0.4, num / den);
  return Number(et0.toFixed(2));
}
async function fetchFarmEnvironmentalAnalysis(farm, forceRefresh = false) {
  const lat = Number(farm.centroidLat.toFixed(4));
  const lon = Number(farm.centroidLon.toFixed(4));
  const cacheKey = `env_${lat}_${lon}_v2`;
  if (!forceRefresh) {
    const cached = db.prepare(`SELECT payload_json, fetched_at, expires_at FROM nasa_cache WHERE cache_key = ?`).get(cacheKey);
    if (cached && cached.expires_at > Date.now()) {
      const parsed = JSON.parse(cached.payload_json);
      return { ...parsed, farmId: farm.id, cacheHit: true };
    }
  }
  const now = /* @__PURE__ */ new Date();
  const endObj = new Date(now.getTime() - 8 * 86400 * 1e3);
  const startObj = new Date(endObj.getTime() - 364 * 86400 * 1e3);
  const startStr = formatYyyymmdd(startObj);
  const endStr = formatYyyymmdd(endObj);
  const currentYear = endObj.getUTCFullYear();
  const monthlyStartYear = currentYear - 4;
  const monthlyEndYear = currentYear;
  const dailyUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETTOP,GWETROOT,ALLSKY_SFC_SW_DWN,RH2M&community=AG&longitude=${lon}&latitude=${lat}&start=${startStr}&end=${endStr}&format=JSON`;
  const monthlyUrl = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR,GWETROOT&community=AG&longitude=${lon}&latitude=${lat}&start=${monthlyStartYear}&end=${monthlyEndYear}&format=JSON`;
  const offset = 2e-3;
  const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat},${(lat + offset).toFixed(4)},${(lat - offset).toFixed(4)},${lat},${lat}&longitude=${lon},${lon},${lon},${(lon + offset).toFixed(4)},${(lon - offset).toFixed(4)}`;
  let dailyJson = null;
  let monthlyJson = null;
  let elevJson = null;
  let powerError = null;
  let elevError = null;
  const [dailyRes, monthlyRes, elevRes] = await Promise.allSettled([
    fetch(dailyUrl, { signal: AbortSignal.timeout(15e3) }),
    fetch(monthlyUrl, { signal: AbortSignal.timeout(15e3) }),
    fetch(elevUrl, { signal: AbortSignal.timeout(8e3) })
  ]);
  if (dailyRes.status === "fulfilled" && dailyRes.value.ok) {
    dailyJson = await dailyRes.value.json();
  } else {
    powerError = dailyRes.status === "fulfilled" ? `HTTP ${dailyRes.value.status}` : String(dailyRes.reason);
  }
  if (monthlyRes.status === "fulfilled" && monthlyRes.value.ok) {
    monthlyJson = await monthlyRes.value.json();
  }
  if (elevRes.status === "fulfilled" && elevRes.value.ok) {
    elevJson = await elevRes.value.json();
  } else {
    elevError = elevRes.status === "fulfilled" ? `HTTP ${elevRes.value.status}` : String(elevRes.reason);
  }
  let elevationMeters = null;
  let terrainSlopePct = null;
  if (elevJson?.elevation && Array.isArray(elevJson.elevation) && elevJson.elevation.length >= 5) {
    const [center, north, south, east, west] = elevJson.elevation;
    elevationMeters = Number(center.toFixed(1));
    const nsDistM = 444;
    const ewDistM = Math.max(120, 444 * Math.cos(lat * Math.PI / 180));
    const dzNs = (north - south) / nsDistM;
    const dzEw = (east - west) / ewDistM;
    terrainSlopePct = Number((Math.sqrt(dzNs * dzNs + dzEw * dzEw) * 100).toFixed(2));
  } else if (dailyJson?.geometry?.coordinates?.[2] !== void 0) {
    elevationMeters = Number(Number(dailyJson.geometry.coordinates[2]).toFixed(1));
  }
  const erosionRiskContext = terrainSlopePct === null ? "Terrain slope unavailable \u2014 local field inspection of runoff channels is recommended." : terrainSlopePct < 2 ? `Gentle slope (~${terrainSlopePct}%): low topographic runoff velocity, though bare soil remains exposed to sheet erosion during heavy storms.` : terrainSlopePct < 6 ? `Moderate undulating slope (~${terrainSlopePct}%): contour planting, residue retention, or living cover crops are advised to curb topsoil runoff.` : `Steeper slope (~${terrainSlopePct}%): elevated water erosion vulnerability during intense rainfall; contour bunds and dense cover crops strongly advised.`;
  const dailySeries = [];
  let missingPowerCount = 0;
  let missingSmapCount = 0;
  if (dailyJson?.properties?.parameter) {
    const p = dailyJson.properties.parameter;
    const dates = Object.keys(p.T2M || {}).sort();
    for (const d of dates) {
      const tMean = cleanVal(p.T2M?.[d]);
      const tMax = cleanVal(p.T2M_MAX?.[d]);
      const tMin = cleanVal(p.T2M_MIN?.[d]);
      const precip = cleanVal(p.PRECTOTCORR?.[d]);
      const smTop = cleanVal(p.GWETTOP?.[d]);
      const smRoot = cleanVal(p.GWETROOT?.[d]);
      const solar = cleanVal(p.ALLSKY_SFC_SW_DWN?.[d]);
      const rh = cleanVal(p.RH2M?.[d]);
      if (tMean === null || precip === null) missingPowerCount++;
      if (smTop === null || smRoot === null) missingSmapCount++;
      dailySeries.push({
        date: formatIsoDate(d),
        tempMeanC: tMean,
        tempMaxC: tMax,
        tempMinC: tMin,
        precipMm: precip,
        soilMoistureTop: smTop,
        soilMoistureRoot: smRoot,
        solarRadiation: solar,
        humidityPct: rh,
        et0Mm: estimateDailyEt0(tMean, tMax, tMin, solar, rh, elevationMeters ?? 200)
      });
    }
  }
  const monthlySeries = [];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (monthlyJson?.properties?.parameter) {
    const mp = monthlyJson.properties.parameter;
    const keys = Object.keys(mp.T2M || {}).filter((k) => !k.endsWith("13")).sort();
    for (const k of keys) {
      const yr = k.slice(0, 4);
      const mo = Number(k.slice(4, 6));
      if (mo < 1 || mo > 12) continue;
      monthlySeries.push({
        month: `${yr}-${String(mo).padStart(2, "0")}`,
        label: `${monthNames[mo - 1]} ${yr.slice(2)}`,
        precipMm: cleanVal(mp.PRECTOTCORR?.[k]),
        tempMeanC: cleanVal(mp.T2M?.[k]),
        soilMoistureRoot: cleanVal(mp.GWETROOT?.[k])
      });
    }
  }
  const validPrecip = dailySeries.map((d) => d.precipMm).filter((v) => v !== null);
  const validTemp = dailySeries.map((d) => d.tempMeanC).filter((v) => v !== null);
  const validTempMax = dailySeries.map((d) => d.tempMaxC).filter((v) => v !== null);
  const validTopSm = dailySeries.map((d) => d.soilMoistureTop).filter((v) => v !== null);
  const validRootSm = dailySeries.map((d) => d.soilMoistureRoot).filter((v) => v !== null);
  const validSolar = dailySeries.map((d) => d.solarRadiation).filter((v) => v !== null);
  const validEt0 = dailySeries.map((d) => d.et0Mm).filter((v) => v !== null);
  const totalRainMm = validPrecip.length > 0 ? Number(validPrecip.reduce((a, b) => a + b, 0).toFixed(1)) : null;
  const avgTempC = validTemp.length > 0 ? Number((validTemp.reduce((a, b) => a + b, 0) / validTemp.length).toFixed(1)) : null;
  const maxTempObservedC = validTempMax.length > 0 ? Number(Math.max(...validTempMax).toFixed(1)) : null;
  const heatStressDaysAbove35C = validTempMax.filter((v) => v >= 35).length;
  const extremeRainDaysAbove30Mm = validPrecip.filter((v) => v >= 30).length;
  let longestDrySpellDays = 0;
  let currentStreak = 0;
  for (const pt of dailySeries) {
    if (pt.precipMm !== null && pt.precipMm < 1) {
      currentStreak++;
      if (currentStreak > longestDrySpellDays) longestDrySpellDays = currentStreak;
    } else {
      currentStreak = 0;
    }
  }
  const avgTopSoilWetness = validTopSm.length > 0 ? Number((validTopSm.reduce((a, b) => a + b, 0) / validTopSm.length).toFixed(3)) : null;
  const avgRootSoilWetness = validRootSm.length > 0 ? Number((validRootSm.reduce((a, b) => a + b, 0) / validRootSm.length).toFixed(3)) : null;
  const recent90 = validRootSm.slice(-90);
  const recentRootAvg = recent90.length > 0 ? recent90.reduce((a, b) => a + b, 0) / recent90.length : null;
  const histRootVals = monthlySeries.map((m) => m.soilMoistureRoot).filter((v) => v !== null);
  const histRootAvg = histRootVals.length > 0 ? histRootVals.reduce((a, b) => a + b, 0) / histRootVals.length : null;
  const soilMoistureAnomalyPct = recentRootAvg !== null && histRootAvg !== null && histRootAvg > 0 ? Number(((recentRootAvg - histRootAvg) / histRootAvg * 100).toFixed(1)) : null;
  const avgSolarRadiation = validSolar.length > 0 ? Number((validSolar.reduce((a, b) => a + b, 0) / validSolar.length).toFixed(2)) : null;
  const estimatedAnnualEt0Mm = validEt0.length > 0 ? Number(validEt0.reduce((a, b) => a + b, 0).toFixed(0)) : null;
  const waterBalanceMm = totalRainMm !== null && estimatedAnnualEt0Mm !== null ? Number((totalRainMm - estimatedAnnualEt0Mm).toFixed(0)) : null;
  const recent30Rain = dailySeries.slice(-30).map((d) => d.precipMm).filter((v) => v !== null).reduce((a, b) => a + b, 0);
  const recent30Root = dailySeries.slice(-30).map((d) => d.soilMoistureRoot).filter((v) => v !== null);
  const recent30RootMean = recent30Root.length > 0 ? recent30Root.reduce((a, b) => a + b, 0) / recent30Root.length : null;
  const ndviProxyContext = recent30RootMean === null ? "Optical vegetation condition requires direct cloud-free Landsat/MODIS inspection in the Geospatial Map layer." : recent30RootMean < 0.42 && recent30Rain < 25 ? "Recent moisture-vegetation conditions appear drier than seasonal mid-range, which commonly coincides with lower canopy greenness or post-harvest dormancy. Local field observation is required to confirm crop vigor vs bare fallow." : "Recent root-zone moisture and incoming solar radiation indicate favorable agroclimatic conditions for vegetative activity. Use the MODIS 8-Day NDVI overlay on the map to inspect regional greenness patterns.";
  const configRows = db.prepare(`SELECT * FROM dataset_configs`).all();
  const obsRangeLabel = dailySeries.length > 0 ? `${dailySeries[0].date} to ${dailySeries[dailySeries.length - 1].date}` : "Query failed / unavailable";
  const datasets = configRows.map((cfg) => {
    let dataQuality = "Regional Context";
    let missingObservations = 0;
    let observationDate = obsRangeLabel;
    if (cfg.id === "power") {
      dataQuality = powerError ? "Unavailable Locally" : missingPowerCount > 0 ? "Partially Missing" : "Verified Live";
      missingObservations = missingPowerCount;
    } else if (cfg.id === "gpm") {
      dataQuality = powerError ? "Unavailable Locally" : missingPowerCount > 0 ? "Partially Missing" : "Verified Live";
      missingObservations = missingPowerCount;
    } else if (cfg.id === "smap") {
      dataQuality = powerError ? "Unavailable Locally" : missingSmapCount > 0 ? "Partially Missing" : "Verified Live";
      missingObservations = missingSmapCount;
    } else if (cfg.id === "srtm") {
      dataQuality = elevError && elevationMeters === null ? "Unavailable Locally" : "Verified Live";
      observationDate = "Static 30m\u201390m DEM baseline";
    } else if (cfg.id === "modis") {
      dataQuality = "Regional Context";
      observationDate = "Live NASA GIBS 8-Day WMTS Layer";
    } else if (cfg.id === "landsat") {
      dataQuality = "Regional Context";
      observationDate = "Archive context (30m optical \u2014 cloud-sensitive)";
    } else if (cfg.id === "ecostress") {
      dataQuality = "Regional Context";
      observationDate = `Harmonized ET0 proxy (${obsRangeLabel})`;
    } else if (cfg.id === "grace") {
      dataQuality = "Regional Context";
      observationDate = "Basin-scale (~300 km) context only";
    } else if (cfg.id === "gedi") {
      dataQuality = "Unavailable Locally";
      observationDate = "No direct ISS Lidar transect verified over plot";
      missingObservations = 1;
    }
    return {
      id: cfg.id,
      datasetName: cfg.dataset_name,
      missionCode: cfg.mission_code,
      dataSource: cfg.data_source,
      observationDate,
      spatialResolution: cfg.spatial_resolution,
      temporalResolution: cfg.temporal_resolution,
      processingMethod: cfg.processing_method,
      dataQuality,
      missingObservations,
      limitations: cfg.limitations,
      enabled: Boolean(cfg.enabled)
    };
  });
  const insights = [
    {
      id: "ins-rain",
      category: "Rainfall",
      title: "Annual Precipitation & Dry-Spell Variability",
      observationType: "Direct Satellite Observation",
      whatWasObserved: totalRainMm !== null ? `Observed ${totalRainMm} mm total precipitation over the past 12 months across the 0.5\xB0 grid cell, including ${extremeRainDaysAbove30Mm} heavy rain days (\u226530 mm) and a longest dry streak of ${longestDrySpellDays} consecutive days (<1 mm).` : `NASA POWER precipitation data could not be retrieved (${powerError ?? "network error"}).`,
      whenObserved: obsRangeLabel,
      whatItCouldMean: totalRainMm !== null && totalRainMm < 650 ? "Annual moisture supply sits in a tighter dryland range where water-demanding cereals face mid-season stress during multi-week dry spells." : "Total seasonal volume can support diversified cereal-legume sequences, provided planting avoids dry-spell bottlenecks and heavy-storm runoff.",
      whatItCannotEstablish: "A 0.5\xB0 (~55 km) gridded product cannot detect whether an isolated afternoon storm hit your specific boundary or missed it by 5 km.",
      additionalInfoNeeded: "Simple on-farm rain gauge logs during planting and flowering months.",
      statusLevel: totalRainMm === null ? "Insufficient Data" : longestDrySpellDays >= 21 || totalRainMm < 600 ? "Elevated Stress" : "Watch"
    },
    {
      id: "ins-temp",
      category: "Temperature",
      title: "Thermal Regime & Heat-Stress Exposure",
      observationType: "Direct Satellite Observation",
      whatWasObserved: avgTempC !== null ? `Mean 2-meter air temperature averaged ${avgTempC} \xB0C, peaking at ${maxTempObservedC} \xB0C with ${heatStressDaysAbove35C} days reaching or exceeding 35 \xB0C.` : "Temperature observations unavailable.",
      whenObserved: obsRangeLabel,
      whatItCouldMean: heatStressDaysAbove35C >= 20 ? "Frequent \u226535 \xB0C afternoons increase pollen sterility risk in flowering maize and accelerate soil surface evaporation." : "Moderate heat-stress exposure; selecting heat-tolerant legumes or shifting sowing dates can reduce flowering-stage thermal risk.",
      whatItCannotEstablish: "Does not capture cooling microclimates under agroforestry shade trees or localized valley frost/heat pockets.",
      additionalInfoNeeded: "Observed flowering dates of previous crops and presence of boundary shade trees.",
      statusLevel: avgTempC === null ? "Insufficient Data" : heatStressDaysAbove35C >= 25 ? "Elevated Stress" : heatStressDaysAbove35C >= 8 ? "Watch" : "Nominal"
    },
    {
      id: "ins-sm",
      category: "Soil Moisture",
      title: "Root-Zone Soil Wetness & 5-Year Anomaly",
      observationType: "Derived Environmental Indicator",
      whatWasObserved: avgRootSoilWetness !== null ? `Assimilated root-zone soil wetness averaged ${(avgRootSoilWetness * 100).toFixed(1)}% saturation index (${soilMoistureAnomalyPct !== null ? `${soilMoistureAnomalyPct >= 0 ? "+" : ""}${soilMoistureAnomalyPct}% vs 5-year baseline` : "baseline pending"}).` : "Root-zone soil wetness index unavailable.",
      whenObserved: obsRangeLabel,
      whatItCouldMean: soilMoistureAnomalyPct !== null && soilMoistureAnomalyPct < -8 ? "Recent 90-day root-zone moisture trails the 5-year seasonal norm, suggesting depleted subsoil reserves entering the next planting window." : "Root-zone moisture tracks near regional seasonal expectations, supporting timely legume establishment after onset of rains.",
      whatItCannotEstablish: "Satellite/assimilated wetness indices (9 km \u2013 55 km) cannot measure soil organic matter, compaction hardpans, or exact field-plot wilting point.",
      additionalInfoNeeded: "Hand-feel soil moisture check at 20 cm depth and local soil texture/organic carbon test.",
      statusLevel: avgRootSoilWetness === null ? "Insufficient Data" : (soilMoistureAnomalyPct ?? 0) < -10 ? "Elevated Stress" : "Nominal"
    },
    {
      id: "ins-veg",
      category: "Vegetation",
      title: "Vegetation Activity & Evapotranspiration Context",
      observationType: "Derived Environmental Indicator",
      whatWasObserved: estimatedAnnualEt0Mm !== null ? `Estimated annual reference evapotranspiration (ET0) is ${estimatedAnnualEt0Mm} mm (climatic water balance: ${waterBalanceMm !== null ? `${waterBalanceMm >= 0 ? "+" : ""}${waterBalanceMm} mm` : "N/A"}). ${ndviProxyContext}` : "Evapotranspiration proxy unavailable.",
      whenObserved: obsRangeLabel,
      whatItCouldMean: waterBalanceMm !== null && waterBalanceMm < -400 ? "Atmospheric evaporative demand substantially exceeds annual rainfall, making mulch cover, zero/reduced tillage, and drought-hardy crops vital." : "Seasonal moisture surplus during wet months can be captured effectively with deep-rooted crops and cover-crop biomass.",
      whatItCannotEstablish: "A low vegetation index or negative annual water balance cannot separate drought stress from intentional harvest clearing, weeding, or nutrient deficiency.",
      additionalInfoNeeded: "Current ground cover status, crop stage photos, and MODIS/Landsat visual check on the interactive map.",
      statusLevel: waterBalanceMm === null ? "Insufficient Data" : waterBalanceMm < -500 ? "Watch" : "Nominal"
    },
    {
      id: "ins-terrain",
      category: "Terrain",
      title: "SRTM Elevation & Topographic Erosion Context",
      observationType: "Direct Satellite Observation",
      whatWasObserved: elevationMeters !== null ? `Farm centroid elevation is ${elevationMeters} m above sea level with an estimated local terrain slope of ${terrainSlopePct ?? "N/A"}%.` : "SRTM elevation unavailable.",
      whenObserved: "Static SRTM / Copernicus 30m\u201390m DEM",
      whatItCouldMean: erosionRiskContext,
      whatItCannotEstablish: "DEM models cannot verify whether farmers have already installed stone bunds, tied ridges, or grass contour strips.",
      additionalInfoNeeded: "Confirmation of existing soil-conservation earthworks or drainage gullies.",
      statusLevel: terrainSlopePct === null ? "Insufficient Data" : terrainSlopePct >= 5 ? "Elevated Stress" : terrainSlopePct >= 2 ? "Watch" : "Nominal"
    },
    {
      id: "ins-grace",
      category: "Water Storage",
      title: "GRACE-FO Regional Aquifer & Basin Context",
      observationType: "Regional Context Only",
      whatWasObserved: "GRACE/GRACE-FO gravity anomalies operate at ~300 km spatial resolution and provide watershed-scale terrestrial water storage trends rather than plot-level soil moisture.",
      whenObserved: "Multi-year monthly basin archive",
      whatItCouldMean: "Useful only for understanding whether the wider river basin or regional groundwater table is experiencing multi-year drying or recharge.",
      whatItCannotEstablish: "Strictly cannot be interpreted as soil moisture within your farm polygon or shallow well depth without local piezometer data.",
      additionalInfoNeeded: "Local borehole/stream seasonal flow observations if supplemental irrigation is planned.",
      statusLevel: "Nominal"
    }
  ];
  const areasForInvestigation = [];
  if (farm.soilPh === null) {
    areasForInvestigation.push("Soil pH is currently marked unknown \u2014 collect a composite topsoil sample (0\u201320 cm) for pH testing before investing in lime or pH-sensitive legumes like Soybean.");
  }
  if (farm.organicMatterPct === null) {
    areasForInvestigation.push("Soil organic matter percentage is unknown \u2014 a simple local extension soil test or Walkley-Black lab check will calibrate green-manure cover crop targets.");
  }
  if (heatStressDaysAbove35C >= 15) {
    areasForInvestigation.push(`Observed ${heatStressDaysAbove35C} days \u226535 \xB0C regionally \u2014 verify with local extension whether early-maturing or heat-tolerant varieties fit your sowing dates.`);
  }
  if (longestDrySpellDays >= 18) {
    areasForInvestigation.push(`A ${longestDrySpellDays}-day dry streak occurred in the past year \u2014 confirm whether mid-season dry spells align with your crop flowering window.`);
  }
  if (farm.pestHistory.trim().length > 0) {
    areasForInvestigation.push(`Reported pest/disease pressure ("${farm.pestHistory}") \u2014 inspect adjacent fields and confirm crop-free host breaks with an agronomist.`);
  }
  if (areasForInvestigation.length === 0) {
    areasForInvestigation.push("Verify satellite-observed rainfall onset timing against local community rain-gauge observations prior to sowing.");
  }
  const analysis = {
    farmId: farm.id,
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString(),
    cacheHit: false,
    coordinates: { lat, lon },
    elevationMeters,
    terrainSlopePct,
    erosionRiskContext,
    periodSummary: {
      startDate: dailySeries[0]?.date ?? startStr,
      endDate: dailySeries[dailySeries.length - 1]?.date ?? endStr,
      totalRainMm,
      avgTempC,
      maxTempObservedC,
      heatStressDaysAbove35C,
      longestDrySpellDays,
      extremeRainDaysAbove30Mm,
      avgTopSoilWetness,
      avgRootSoilWetness,
      soilMoistureAnomalyPct,
      avgSolarRadiation,
      estimatedAnnualEt0Mm,
      waterBalanceMm,
      ndviProxyContext
    },
    dailySeries,
    monthlySeries,
    datasets,
    insights,
    areasForInvestigation
  };
  if (!powerError) {
    db.prepare(
      `INSERT OR REPLACE INTO nasa_cache (cache_key, payload_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?)`
    ).run(cacheKey, JSON.stringify(analysis), analysis.fetchedAt, Date.now() + 12 * 3600 * 1e3);
  }
  return analysis;
}

// server/rotationEngine.ts
function pickCrop(crops, preferredNames, fallbackName) {
  for (const name of preferredNames) {
    const found = crops.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
    if (found) return found;
  }
  return crops.find((c) => c.name.toLowerCase().includes(fallbackName.toLowerCase())) ?? crops[0];
}
function hasPriority(farm, keyword) {
  return farm.priorities.some((p) => p.toLowerCase().includes(keyword.toLowerCase()));
}
function makeIndicators(farm, ratings) {
  const order = [
    "Soil Health",
    "Water Demand",
    "Nutrient Cycling",
    "Organic Matter",
    "Erosion",
    "Pest Management",
    "Climate Resilience",
    "Market Suitability"
  ];
  return order.map((indicator) => {
    const item = ratings[indicator];
    const matched = hasPriority(farm, item.priorityKey);
    return {
      indicator,
      rating: item.rating,
      explanation: item.explanation,
      alignmentWithPriorities: matched ? `Directly addresses your selected priority (${item.priorityKey}).` : "Secondary co-benefit relative to your top selected priorities."
    };
  });
}
function generateRotationStrategies(farm, env, crops) {
  const totalRain = env.periodSummary.totalRainMm ?? 800;
  const heatDays = env.periodSummary.heatStressDaysAbove35C;
  const slopePct = env.terrainSlopePct ?? 1.5;
  const isDryland = totalRain < 680 || env.periodSummary.longestDrySpellDays >= 18;
  const isSteep = slopePct >= 4;
  const wantsForage = hasPriority(farm, "forage");
  const wantsErosion = hasPriority(farm, "erosion") || isSteep;
  const wantsMarket = hasPriority(farm, "market");
  const wantsWater = hasPriority(farm, "water") || isDryland;
  const missingInfo = [];
  if (farm.soilPh === null) missingInfo.push("Laboratory soil pH is unknown (limits precision for pH-sensitive legumes such as Soybean).");
  if (farm.organicMatterPct === null) missingInfo.push("Baseline soil organic matter (%) is unknown.");
  if (farm.soilFertility.toLowerCase().includes("unknown")) missingInfo.push("Current soil N-P-K fertility status is unmeasured.");
  if (totalRain === null) missingInfo.push("Local rain-gauge validation of NASA 0.5\xB0 precipitation data.");
  const currentCropName = farm.currentCrops[0] || farm.previousCrops[0] || "Maize";
  const prevCropName = farm.previousCrops[0] || currentCropName;
  const secondCurrent = farm.currentCrops[1] || currentCropName;
  const baseCrop1 = pickCrop(crops, [currentCropName], "Maize");
  const baseCrop2 = pickCrop(crops, [secondCurrent, prevCropName], "Maize");
  const isMonocropCereal = baseCrop1.family.includes("Poaceae") && baseCrop2.family.includes("Poaceae") && farm.previousCrops.every((c) => !c.toLowerCase().includes("cowpea") && !c.toLowerCase().includes("groundnut") && !c.toLowerCase().includes("soy"));
  const strategyA = {
    id: "strategy_a",
    label: "Strategy A",
    title: "Current Practice Baseline",
    subtitle: `Continuation of ${[.../* @__PURE__ */ new Set([prevCropName, currentCropName])].join(" \u2192 ")} sequence`,
    steps: [
      {
        seasonLabel: "Season 1 (Major Rains)",
        cropName: baseCrop1.name,
        cropFamily: baseCrop1.family,
        plantingWindow: farm.plantingSeasons || "Main rainy onset",
        durationDays: baseCrop1.growingDurationDays,
        roleInRotation: "Primary staple / current baseline crop"
      },
      {
        seasonLabel: "Season 2 (Minor / Next Cycle)",
        cropName: baseCrop2.name,
        cropFamily: baseCrop2.family,
        plantingWindow: "Secondary rains or next main season",
        durationDays: baseCrop2.growingDurationDays,
        roleInRotation: "Repeated baseline crop pattern"
      },
      {
        seasonLabel: "Season 3 (Year 2 Major)",
        cropName: baseCrop1.name,
        cropFamily: baseCrop1.family,
        plantingWindow: "Main rainy onset",
        durationDays: baseCrop1.growingDurationDays,
        roleInRotation: "Continued staple production without structural break"
      },
      {
        seasonLabel: "Season 4 (Year 2 Minor)",
        cropName: farm.plannedCrops[0] ? pickCrop(crops, [farm.plannedCrops[0]], baseCrop2.name).name : baseCrop2.name,
        cropFamily: farm.plannedCrops[0] ? pickCrop(crops, [farm.plannedCrops[0]], baseCrop2.name).family : baseCrop2.family,
        plantingWindow: "Secondary window",
        durationDays: baseCrop2.growingDurationDays,
        roleInRotation: "Farmer planned follow-up"
      }
    ],
    soilHealthBenefits: isMonocropCereal ? "Minimal soil-building benefit when cereal grasses repeat consecutively; root architecture remains in the same shallow-to-mid soil horizon." : "Maintains familiar soil management, though lacks dedicated cover-crop biomass restoration.",
    nutrientCycling: isMonocropCereal ? "Continuous net nitrogen and phosphorus extraction without biological N2 fixation increases reliance on mineral fertilizer." : "Partial nutrient cycling depending on residue incorporation.",
    waterRequirements: `Matches existing water demand (${baseCrop1.waterReqMm}); ${isDryland ? "vulnerable during multi-week dry spells if high-demand maize dominates." : "generally supported by observed annual rainfall if planting is timely."}`,
    erosionReduction: isSteep ? "Exposed inter-row soil during early establishment presents elevated sheet erosion risk on your ~" + slopePct + "% slope." : "Moderate surface residue if stover is left unburned on the field.",
    organicMatterContribution: "Low to moderate unless all crop stover is retained rather than burned or removed.",
    pestCycleDisruption: isMonocropCereal ? "Weak pest-cycle disruption: continuous Poaceae hosts sustain Fall Armyworm, stem borers, and Striga seedbanks." : "Limited host-family interruption across seasons.",
    forageOpportunities: baseCrop1.foragePotential,
    marketConsiderations: "High familiarity with existing buyers and storage channels; avoids immediate seed-sourcing changes.",
    environmentalRisks: [
      ...isMonocropCereal ? ["Progressive nitrogen depletion and Striga/armyworm carryover across continuous cereal seasons."] : [],
      ...heatDays >= 15 ? [`Observed ${heatDays} regional days \u226535 \xB0C pose flowering heat-stress risk if varieties are not staggered.`] : [],
      ...isDryland ? ["High sensitivity to mid-season dry spells observed in NASA POWER precipitation records."] : []
    ],
    missingInformation: missingInfo,
    requiredLocalValidation: [
      "Confirm actual seasonal yields over the past 2\u20133 harvests to quantify nutrient drawdown.",
      "Inspect field patches for Striga emergence or root-feeding pests."
    ],
    indicators: makeIndicators(farm, {
      "Soil Health": {
        rating: isMonocropCereal ? "Higher Risk" : "Balanced",
        explanation: isMonocropCereal ? "Repeated cereal extraction degrades soil structure and nitrogen over time." : "Maintains baseline soil status without active restoration.",
        priorityKey: "soil health"
      },
      "Water Demand": {
        rating: baseCrop1.waterTier === "High" ? "Elevated Demand" : "Balanced",
        explanation: `Dominated by ${baseCrop1.name} (${baseCrop1.waterReqMm} seasonal requirement).`,
        priorityKey: "water"
      },
      "Nutrient Cycling": {
        rating: isMonocropCereal ? "Higher Risk" : "Balanced",
        explanation: "Zero biological nitrogen fixation in cereal-only cycles.",
        priorityKey: "nutrient"
      },
      "Organic Matter": {
        rating: "Balanced",
        explanation: "Depends strictly on whether stover residues are retained as mulch.",
        priorityKey: "organic matter"
      },
      Erosion: {
        rating: isSteep ? "Higher Risk" : "Balanced",
        explanation: isSteep ? "Wide-spaced row crops leave topsoil exposed on sloped ground." : "Moderate ground cover during peak canopy only.",
        priorityKey: "erosion"
      },
      "Pest Management": {
        rating: isMonocropCereal ? "Higher Risk" : "Balanced",
        explanation: "Same-family host continuity sustains pest and weed lifecycles.",
        priorityKey: "pest"
      },
      "Climate Resilience": {
        rating: isDryland || heatDays > 15 ? "Higher Risk" : "Balanced",
        explanation: "Single-crop timing increases vulnerability to rainfall onset shifts or heat spikes.",
        priorityKey: "rainfall"
      },
      "Market Suitability": {
        rating: "High Benefit",
        explanation: "Fully aligned with established local market channels and farmer equipment.",
        priorityKey: "market"
      }
    })
  };
  const droughtCereal = pickCrop(crops, isDryland ? ["Sorghum", "Pearl Millet"] : ["Maize", "Sorghum"], "Sorghum");
  const resilientLegume = pickCrop(crops, isDryland ? ["Cowpea", "Lablab Bean"] : ["Cowpea", "Groundnut"], "Cowpea");
  const restorativeCover = pickCrop(
    crops,
    wantsForage ? ["Lablab Bean", "Pigeon Pea"] : wantsErosion ? ["Mucuna (Velvet Bean)", "Sunn Hemp"] : ["Sunn Hemp", "Mucuna (Velvet Bean)"],
    "Mucuna"
  );
  const anchorCropB = pickCrop(crops, isDryland ? ["Pearl Millet", "Sorghum"] : ["Maize", "Sweet Potato"], "Maize");
  const strategyB = {
    id: "strategy_b",
    label: "Strategy B",
    title: "Soil & Moisture Resilience Sequence",
    subtitle: `${resilientLegume.name} \u2192 ${anchorCropB.name} \u2192 ${restorativeCover.name} \u2192 ${droughtCereal.name}`,
    steps: [
      {
        seasonLabel: "Season 1 (Soil Rebuild & N-Fixation)",
        cropName: resilientLegume.name,
        cropFamily: resilientLegume.family,
        plantingWindow: "Early rains / transition window",
        durationDays: resilientLegume.growingDurationDays,
        roleInRotation: `Fixes ~${resilientLegume.nitrogenFixingKgHa} kg N/ha and disrupts cereal pest/Striga cycles`
      },
      {
        seasonLabel: "Season 2 (Main Staple Harvest)",
        cropName: anchorCropB.name,
        cropFamily: anchorCropB.family,
        plantingWindow: "Main rainy season onset",
        durationDays: anchorCropB.growingDurationDays,
        roleInRotation: "Captures residual biological nitrogen fixed in Season 1"
      },
      {
        seasonLabel: "Season 3 (Biomass & Canopy Cover)",
        cropName: restorativeCover.name,
        cropFamily: restorativeCover.family,
        plantingWindow: "Minor rains or relay-sown",
        durationDays: restorativeCover.growingDurationDays,
        roleInRotation: "Dense canopy curbs erosion, suppresses weeds, and builds organic matter"
      },
      {
        seasonLabel: "Season 4 (Drought-Buffered Cereal)",
        cropName: droughtCereal.name,
        cropFamily: droughtCereal.family,
        plantingWindow: "Main rains",
        durationDays: droughtCereal.growingDurationDays,
        roleInRotation: "Deep-rooted grain & fodder resilience under erratic rainfall"
      }
    ],
    soilHealthBenefits: "Alternates deep taproots (legumes/cover crops) with fibrous cereal roots to break compaction layers, increase microbial diversity, and rebuild topsoil structure.",
    nutrientCycling: `Combines ${resilientLegume.name} (~${resilientLegume.nitrogenFixingKgHa} kg N/ha) and ${restorativeCover.name} (~${restorativeCover.nitrogenFixingKgHa} kg N/ha) ahead of heavy-feeding cereals.`,
    waterRequirements: `${wantsWater ? "Lower seasonal moisture risk: " : ""}${resilientLegume.name} (${resilientLegume.waterReqMm}) and ${droughtCereal.name} (${droughtCereal.waterReqMm}) tolerate intermittent dry spells better than continuous maize.`,
    erosionReduction: `Dense trailing canopy from ${restorativeCover.name} shields bare soil from intense \u226530 mm storm impact on ${slopePct}% terrain.`,
    organicMatterContribution: `High biomass return from ${restorativeCover.name} and legume leaf drop supports long-term organic carbon recovery.`,
    pestCycleDisruption: `Alternating Fabaceae and Poaceae breaks Fall Armyworm, stem borer, and Striga hermonthica cycles (${resilientLegume.name} acts as a false Striga host).`,
    forageOpportunities: `${resilientLegume.name} haulms and ${droughtCereal.name} stover provide protein-balanced dry-season livestock feed.`,
    marketConsiderations: "Trades one minor-season cash harvest for a soil-building cover/forage crop; long-term yield stability offsets short-term cover-crop seed cost.",
    environmentalRisks: [
      "Cover crop biomass requires timely termination before seed set or before planting the next staple to avoid moisture competition.",
      ...farm.soilPh !== null && farm.soilPh < 5.3 ? ["Low soil pH (<5.3) may reduce rhizobial nodulation efficiency without local organic amendment or liming."] : []
    ],
    missingInformation: missingInfo,
    requiredLocalValidation: [
      `Confirm local seed availability and rhizobium inoculant access for ${resilientLegume.name} and ${restorativeCover.name}.`,
      "Verify whether livestock free-grazing rules allow retaining cover-crop mulch on the field during the dry season."
    ],
    indicators: makeIndicators(farm, {
      "Soil Health": {
        rating: "High Benefit",
        explanation: "Multi-layer rooting plus two biological nitrogen-fixing phases actively restore soil structure.",
        priorityKey: "soil health"
      },
      "Water Demand": {
        rating: "High Benefit",
        explanation: "Prioritizes drought-tolerant crops and mulch cover that reduces soil evaporation.",
        priorityKey: "water"
      },
      "Nutrient Cycling": {
        rating: "High Benefit",
        explanation: "Dual legume/green-manure phases supply organic nitrogen ahead of cereals.",
        priorityKey: "nutrient"
      },
      "Organic Matter": {
        rating: "High Benefit",
        explanation: `${restorativeCover.name} contributes substantial surface mulch and root biomass.`,
        priorityKey: "organic matter"
      },
      Erosion: {
        rating: "High Benefit",
        explanation: "Rapid ground cover reduces raindrop splash and surface runoff.",
        priorityKey: "erosion"
      },
      "Pest Management": {
        rating: "High Benefit",
        explanation: "Two non-cereal breaks strongly suppress Striga, nematodes, and cereal borers.",
        priorityKey: "pest"
      },
      "Climate Resilience": {
        rating: "High Benefit",
        explanation: "Spreads thermal and dry-spell risk across diverse planting windows and root depths.",
        priorityKey: "rainfall"
      },
      "Market Suitability": {
        rating: "Moderate Benefit",
        explanation: "Strong grain/forage value, though Season 3 prioritizes soil recovery over direct cash sales.",
        priorityKey: "market"
      }
    })
  };
  const cashLegume = pickCrop(
    crops,
    farm.plannedCrops.some((p) => p.toLowerCase().includes("groundnut")) ? ["Groundnut", "Soybean"] : ["Soybean", "Groundnut"],
    "Soybean"
  );
  const stapleCereal = pickCrop(crops, [currentCropName, "Maize", "Sorghum"], "Maize");
  const shortPulse = pickCrop(crops, ["Cowpea", "Chickpea", "Pigeon Pea"], "Cowpea");
  const diversifiedCrop = pickCrop(
    crops,
    totalRain > 850 ? ["Sweet Potato (Orange-Fleshed)", "Cassava", "Groundnut"] : ["Groundnut", "Pigeon Pea"],
    "Groundnut"
  );
  const strategyC = {
    id: "strategy_c",
    label: "Strategy C",
    title: "Market-Balanced Diversified Rotation",
    subtitle: `${cashLegume.name} \u2192 ${stapleCereal.name} \u2192 ${shortPulse.name} \u2192 ${diversifiedCrop.name}`,
    steps: [
      {
        seasonLabel: "Season 1 (High-Value N-Fixing Legume)",
        cropName: cashLegume.name,
        cropFamily: cashLegume.family,
        plantingWindow: "Main rainy onset",
        durationDays: cashLegume.growingDurationDays,
        roleInRotation: `Commercial protein/oilseed crop fixing ~${cashLegume.nitrogenFixingKgHa} kg N/ha`
      },
      {
        seasonLabel: "Season 2 (Primary Staple Cereal)",
        cropName: stapleCereal.name,
        cropFamily: stapleCereal.family,
        plantingWindow: "Following major or minor rains",
        durationDays: stapleCereal.growingDurationDays,
        roleInRotation: "Benefits from legume residual N and cleaner weed-suppressed seedbed"
      },
      {
        seasonLabel: "Season 3 (Short-Cycle Pulse Break)",
        cropName: shortPulse.name,
        cropFamily: shortPulse.family,
        plantingWindow: "Minor rains / residual moisture",
        durationDays: shortPulse.growingDurationDays,
        roleInRotation: "Fast harvestable grain & nitrogen recharge during shorter rain window"
      },
      {
        seasonLabel: "Season 4 (Diversified Market / Root Crop)",
        cropName: diversifiedCrop.name,
        cropFamily: diversifiedCrop.family,
        plantingWindow: "Year 2 rainy season",
        durationDays: diversifiedCrop.growingDurationDays,
        roleInRotation: "Income diversification across different crop family and market price cycle"
      }
    ],
    soilHealthBenefits: "Maintains continuous harvestable output while alternating legumes, cereals, and non-cereal broadleaf/root crops across four seasons.",
    nutrientCycling: `Balances nitrogen export from ${stapleCereal.name} with two harvestable legume phases (${cashLegume.name} and ${shortPulse.name}); phosphorus and potassium replenishment remains essential because grain harvests export nutrients off-farm.`,
    waterRequirements: `${cashLegume.name} (${cashLegume.waterReqMm}) and ${stapleCereal.name} (${stapleCereal.waterReqMm}) carry moderate-to-high water needs during pod fill and tasseling.`,
    erosionReduction: "Good canopy diversity across seasons, though lower surface mulch volume than a dedicated Mucuna/Sunn Hemp cover season.",
    organicMatterContribution: "Moderate \u2014 depends on returning legume haulms and cereal stover after grain harvest.",
    pestCycleDisruption: "Effective rotation across 3 distinct botanical families reduces single-crop insect and pathogen buildup.",
    forageOpportunities: `${shortPulse.name} haulms and cereal stover provide secondary feed alongside primary grain markets.`,
    marketConsiderations: `${wantsMarket ? "Strongly aligned with market goals: " : ""}Every season yields a marketable food or cash crop, spreading household income and price risk across 4 commodities.`,
    environmentalRisks: [
      `${cashLegume.name} requires reliable moisture during flowering/pod-fill and near-neutral pH (ideal ${cashLegume.phMin}\u2013${cashLegume.phMax}).`,
      "Higher off-farm nutrient export when all four seasons are harvested for grain \u2014 monitor phosphorus and potassium balance."
    ],
    missingInformation: missingInfo,
    requiredLocalValidation: [
      `Verify soil pH (${farm.soilPh !== null ? `reported ${farm.soilPh}` : "currently unknown"}) and phosphorus levels before scaling ${cashLegume.name}.`,
      "Confirm local buyer demand, drying capacity (aflatoxin prevention for Groundnut/Maize), and certified seed availability."
    ],
    indicators: makeIndicators(farm, {
      "Soil Health": {
        rating: "Moderate Benefit",
        explanation: "Alternates root depths and crop families across every season without sacrificing harvests.",
        priorityKey: "soil health"
      },
      "Water Demand": {
        rating: isDryland ? "Elevated Demand" : "Balanced",
        explanation: `${cashLegume.name} and ${stapleCereal.name} need reliable pod-fill and grain-fill moisture.`,
        priorityKey: "water"
      },
      "Nutrient Cycling": {
        rating: "Moderate Benefit",
        explanation: "Biological N fixation offsets part of cereal demand, though grain harvest exports P & K.",
        priorityKey: "nutrient"
      },
      "Organic Matter": {
        rating: "Moderate Benefit",
        explanation: "Legume and cereal residues add moderate carbon if not removed for fuel or burning.",
        priorityKey: "organic matter"
      },
      Erosion: {
        rating: "Moderate Benefit",
        explanation: "Spreading canopies like Groundnut/Cowpea protect soil better than cereal monoculture.",
        priorityKey: "erosion"
      },
      "Pest Management": {
        rating: "High Benefit",
        explanation: "Alternating legume, cereal, and diversified family breaks pest continuity.",
        priorityKey: "pest"
      },
      "Climate Resilience": {
        rating: "Moderate Benefit",
        explanation: "Diversified harvest windows buffer single-crop failure, though cash legumes are sensitive to severe drought.",
        priorityKey: "rainfall"
      },
      "Market Suitability": {
        rating: "High Benefit",
        explanation: "Four marketable harvests diversify farm revenue and household nutrition.",
        priorityKey: "market"
      }
    })
  };
  return [strategyA, strategyB, strategyC];
}
function simulateClimateScenarios(farm, env, strategies, params) {
  const baselineRain = env.periodSummary.totalRainMm ?? 850;
  const baselineTemp = env.periodSummary.avgTempC ?? 26.5;
  const simulatedRainMm = Number((baselineRain * (1 + params.rainfallChangePct / 100)).toFixed(0));
  const simulatedTempC = Number((baselineTemp + params.tempShiftC).toFixed(1));
  const effectiveRainAfterWaterDrop = simulatedRainMm * (1 - params.waterAvailabilityDropPct / 100);
  const recent12Months = env.monthlySeries.slice(-12);
  const monthlyComparison = recent12Months.length >= 6 ? recent12Months.map((m) => {
    const baseRainMo = m.precipMm !== null ? Number((m.precipMm * 30).toFixed(1)) : 65;
    const baseTempMo = m.tempMeanC ?? baselineTemp;
    return {
      month: m.label,
      baselineRainMm: baseRainMo,
      scenarioRainMm: Number(Math.max(0, baseRainMo * (1 + params.rainfallChangePct / 100)).toFixed(1)),
      baselineTempC: Number(baseTempMo.toFixed(1)),
      scenarioTempC: Number((baseTempMo + params.tempShiftC).toFixed(1))
    };
  }) : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((mo, idx) => {
    const seasonalFactor = Math.sin((idx - 2) / 12 * Math.PI * 2) * 0.45 + 0.6;
    const baseRainMo = Number((baselineRain / 12 * Math.max(0.15, seasonalFactor)).toFixed(1));
    const baseTempMo = Number((baselineTemp + Math.cos(idx / 12 * Math.PI * 2) * 1.8).toFixed(1));
    return {
      month: mo,
      baselineRainMm: baseRainMo,
      scenarioRainMm: Number(Math.max(0, baseRainMo * (1 + params.rainfallChangePct / 100)).toFixed(1)),
      baselineTempC: baseTempMo,
      scenarioTempC: Number((baseTempMo + params.tempShiftC).toFixed(1))
    };
  });
  const isDryStress = params.rainfallChangePct <= -15 || params.waterAvailabilityDropPct >= 20 || effectiveRainAfterWaterDrop < 600;
  const isHeatStress = params.tempShiftC >= 1.5 || params.extraHeatStressDays >= 10 || simulatedTempC >= 29;
  const isStormErosion = params.extremeRainIntensity !== "baseline" || params.rainfallChangePct >= 20;
  const outcomes = strategies.map((strat) => {
    if (strat.id === "strategy_a") {
      return {
        strategyId: strat.id,
        strategyTitle: strat.title,
        projectedWaterBalanceNote: isDryStress ? `Simulated effective moisture (${effectiveRainAfterWaterDrop.toFixed(0)} mm) falls short of repeated cereal peak demand, increasing mid-season wilting risk.` : `Moisture supply (${effectiveRainAfterWaterDrop.toFixed(0)} mm) remains adequate, though intense storm runoff could leach surface nitrogen.`,
        thermalStressExposure: isHeatStress ? "High" : "Moderate",
        moistureVulnerability: isDryStress ? "High" : "Moderate",
        erosionExposure: isStormErosion ? "High" : "Moderate",
        agronomicSummary: isDryStress || isHeatStress ? "Hypothetical stress exposes continuous baseline cropping to simultaneous pollination heat injury, low soil-moisture buffering, and heightened Striga competition." : "Under milder hypothetical shifts, baseline production persists but continues gradual nutrient drawdown.",
        adaptationActions: [
          "Shift sowing window to avoid peak thermal spike at cereal flowering.",
          "Transition at least one season to a drought-tolerant legume break before stress compounds."
        ]
      };
    }
    if (strat.id === "strategy_b") {
      return {
        strategyId: strat.id,
        strategyTitle: strat.title,
        projectedWaterBalanceNote: isDryStress ? `Mulch retention and drought-hardy crops buffer ${effectiveRainAfterWaterDrop.toFixed(0)} mm simulated rainfall; cover-crop termination timing must be brought earlier to save moisture.` : `Higher simulated moisture (${effectiveRainAfterWaterDrop.toFixed(0)} mm) maximizes cover-crop biomass and nitrogen fixation.`,
        thermalStressExposure: isHeatStress ? "Moderate" : "Low",
        moistureVulnerability: isDryStress ? "Moderate" : "Low",
        erosionExposure: "Low",
        agronomicSummary: "Hypothetical simulation suggests Strategy B maintains the strongest moisture buffering and soil surface armor under both drought and intense-storm scenarios.",
        adaptationActions: [
          params.rainfallChangePct <= -20 ? "Terminate cover crop 2\u20133 weeks earlier to preserve subsoil water for the succeeding staple." : "Retain full cover residue on surface to cool soil temperatures and slow storm runoff.",
          "Select short-cycle (65-day) cowpea varieties if rainy-season length contracts."
        ]
      };
    }
    return {
      strategyId: strat.id,
      strategyTitle: strat.title,
      projectedWaterBalanceNote: isDryStress ? `Pod-filling cash legumes face moderate yield compression under ${effectiveRainAfterWaterDrop.toFixed(0)} mm simulated effective water unless supplemental water or tied ridges are used.` : `Diversified crops capitalize well on ${effectiveRainAfterWaterDrop.toFixed(0)} mm moisture, provided well-drained ridges prevent waterlogging in ${farm.soilTexture} soil.`,
      thermalStressExposure: isHeatStress ? "Moderate" : "Low",
      moistureVulnerability: isDryStress ? "High" : "Low",
      erosionExposure: isStormErosion ? "Moderate" : "Low",
      agronomicSummary: "Hypothetical scenario highlights income resilience across multiple crops, with moderate sensitivity to severe dry spells during high-value legume pod fill.",
      adaptationActions: [
        "Use contour ridges or tied-ridging to capture storm bursts for pod-filling legumes.",
        "Keep short-cycle Cowpea or Pigeon Pea ready as a contingency crop if rains arrive late."
      ]
    };
  });
  return {
    disclaimer: "HYPOTHETICAL SCENARIO SIMULATION \u2014 NOT A WEATHER FORECAST. Outputs illustrate relative crop-rotation sensitivity to user-adjusted rainfall, temperature, and water stress parameters against your historical NASA POWER baseline.",
    baselineSummary: {
      annualRainMm: env.periodSummary.totalRainMm,
      meanTempC: env.periodSummary.avgTempC,
      simulatedRainMm,
      simulatedTempC
    },
    monthlyComparison,
    outcomes
  };
}

// server/aiAssistant.ts
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
}
async function askAgriAssistant(farm, env, strategies, history, userQuestion) {
  const aiSettings = db.prepare(`SELECT * FROM ai_settings WHERE id = 'default'`).get();
  const modelName = aiSettings?.model_name || "gemini-4-hydrogen";
  const tone = aiSettings?.system_tone || "Practical, respectful agronomic advisor grounded in empirical observation";
  const strictDisclaimer = aiSettings ? Boolean(aiSettings.strict_scientific_disclaimer) : true;
  const maxTurns = aiSettings?.max_history_turns ?? 12;
  const ai = getAiClient();
  if (!ai) {
    throw new Error(
      "Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets to enable the AI Agricultural Assistant."
    );
  }
  const missingDataList = [
    farm.soilPh === null ? "Soil pH (unknown)" : `Soil pH: ${farm.soilPh}`,
    farm.organicMatterPct === null ? "Soil organic matter % (unknown)" : `Organic matter: ${farm.organicMatterPct}%`,
    `Soil fertility reported: ${farm.soilFertility}`
  ].join("; ");
  const systemInstruction = `You are FarmNova AI's Agricultural Intelligence Assistant.
Tone: ${tone}.
Target Audience: Farmers and local agricultural extension staff\u2014use clear, practical, non-jargon language while remaining scientifically rigorous.

STRICT SCIENTIFIC TRANSPARENCY RULES:
1. NEVER invent or guess satellite measurements, NDVI values, yields, or weather figures not explicitly provided in the Farm & NASA Context below.
2. Always distinguish between:
   - Direct satellite/meteorological observations (e.g., NASA POWER precipitation/temperature, SRTM elevation)
   - Derived indicators (e.g., FAO-56 ET0 water balance, moisture anomalies)
   - Expert-validated agronomic knowledge (e.g., legume nitrogen fixation, Striga host interruption)
   - Local unknowns requiring field or lab testing.
3. Explicitly note spatial resolution limits when discussing satellite data (e.g., NASA POWER is 0.5\xB0 / ~55 km regional grid; GRACE is ~300 km basin context and NOT field soil moisture).
4. Support the farmer's judgment and recommend consulting local extension agronomists before major capital commitments.
${strictDisclaimer ? "5. End or weave in a brief note identifying what local information is still missing before finalizing a field decision if gaps exist." : ""}

REGISTERED FARM CONTEXT:
- Farm Name: ${farm.name} (${farm.sizeHectares} ha, ${farm.farmingType})
- Location: ${farm.district}, ${farm.region}, ${farm.country} (Centroid: ${farm.centroidLat.toFixed(4)}, ${farm.centroidLon.toFixed(4)})
- Soil Profile: ${farm.soilType}, Texture: ${farm.soilTexture}, Drainage: ${farm.drainage}, Irrigation: ${farm.irrigationAvailable}
- Soil Measurement Gaps / Knowns: ${missingDataList}
- Previous Crops: ${farm.previousCrops.join(", ") || "None recorded"}
- Current Crops: ${farm.currentCrops.join(", ") || "None recorded"}
- Planned Crops: ${farm.plannedCrops.join(", ") || "None recorded"}
- Planting Seasons: ${farm.plantingSeasons} | Harvest: ${farm.harvestPeriods}
- Pest & Disease History: ${farm.pestHistory || "None reported"}
- Farmer Priorities: ${farm.priorities.join(", ") || "General resilience"}

LIVE NASA EARTH OBSERVATION & TERRAIN SUMMARY (${env.periodSummary.startDate} to ${env.periodSummary.endDate}):
- SRTM Elevation: ${env.elevationMeters !== null ? `${env.elevationMeters} m` : "Unavailable"} | Estimated Slope: ${env.terrainSlopePct !== null ? `${env.terrainSlopePct}%` : "Unavailable"}
- Total Observed Precipitation (NASA POWER/GPM heritage): ${env.periodSummary.totalRainMm !== null ? `${env.periodSummary.totalRainMm} mm` : "Unavailable"}
- Longest Dry Spell (<1mm/day): ${env.periodSummary.longestDrySpellDays} days | Heavy Rain Days (>=30mm): ${env.periodSummary.extremeRainDaysAbove30Mm}
- Mean 2m Temperature: ${env.periodSummary.avgTempC !== null ? `${env.periodSummary.avgTempC} \xB0C` : "Unavailable"} | Max Observed: ${env.periodSummary.maxTempObservedC !== null ? `${env.periodSummary.maxTempObservedC} \xB0C` : "N/A"} | Heat Stress Days (>=35\xB0C): ${env.periodSummary.heatStressDaysAbove35C}
- Root-Zone Soil Wetness Index (0-1 assimilated): ${env.periodSummary.avgRootSoilWetness ?? "Unavailable"} (90-day anomaly vs 5-yr baseline: ${env.periodSummary.soilMoistureAnomalyPct !== null ? `${env.periodSummary.soilMoistureAnomalyPct}%` : "N/A"})
- Estimated Annual Reference ET0: ${env.periodSummary.estimatedAnnualEt0Mm !== null ? `${env.periodSummary.estimatedAnnualEt0Mm} mm` : "Unavailable"} | Climatic Water Balance: ${env.periodSummary.waterBalanceMm !== null ? `${env.periodSummary.waterBalanceMm} mm` : "N/A"}
- Vegetation Context: ${env.periodSummary.ndviProxyContext}

GENERATED CROP ROTATION STRATEGIES:
${strategies.map(
    (s) => `${s.label} \u2014 ${s.title}: ${s.subtitle}
  Steps: ${s.steps.map((st) => `${st.seasonLabel}: ${st.cropName} (${st.durationDays})`).join(" | ")}
  Nutrient Cycling: ${s.nutrientCycling}
  Water: ${s.waterRequirements}
  Risks: ${s.environmentalRisks.join(" ")}
  Missing Info: ${s.missingInformation.join(" ")}`
  ).join("\n\n")}`;
  const recentTurns = history.slice(-maxTurns);
  const formattedHistory = recentTurns.map((m) => `${m.role === "user" ? "Farmer" : "Assistant"}: ${m.content}`).join("\n\n");
  const prompt = formattedHistory ? `Previous conversation:
${formattedHistory}

Farmer's new question: ${userQuestion}` : `Farmer's question: ${userQuestion}`;
  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });
  const answer = (response.text ?? "").trim();
  if (!answer) {
    throw new Error("The AI assistant returned an empty response. Please try rephrasing your question.");
  }
  return { answer, modelUsed: modelName };
}

// server/supabaseEdge.ts
import { createClient } from "@supabase/supabase-js";
function resolveSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "").trim();
  const functionSlug = (process.env.SUPABASE_EDGE_FUNCTION_SLUG || process.env.VITE_SUPABASE_EDGE_FUNCTION_SLUG || "farmnova-edge").trim();
  const configured = Boolean(url && key && url.startsWith("http"));
  return { url, key, functionSlug, configured };
}
function getSupabaseEdgeStatus() {
  const { url, functionSlug, configured } = resolveSupabaseConfig();
  return {
    configured,
    functionSlug,
    mode: configured ? "supabase-remote" : "local-edge-bridge",
    endpoint: configured ? `${url.replace(/\/+$/, "")}/functions/v1/${functionSlug}` : `/api/edge/invoke (${functionSlug})`,
    supportedActions: ["health", "nasa-telemetry", "rotation-brief", "ai-advisor"]
  };
}
function buildLocalRotationBrief(farm, analysis, strategies, payload) {
  const farmName = farm?.name || String(payload.farmName || "Registered Farm");
  const location = farm ? `${farm.region}, ${farm.country}` : [payload.region, payload.country].filter(Boolean).join(", ");
  const soilPh = farm ? farm.soilPh : payload.soilPh ?? null;
  const organicMatterPct = farm ? farm.organicMatterPct : payload.organicMatterPct ?? null;
  const currentCrops = farm ? farm.currentCrops : Array.isArray(payload.currentCrops) ? payload.currentCrops.map(String) : [];
  const totalRainMm = analysis?.periodSummary.totalRainMm ?? (typeof payload.totalRainMm === "number" ? payload.totalRainMm : null);
  const avgRootSoilWetness = analysis?.periodSummary.avgRootSoilWetness ?? (typeof payload.avgRootSoilWetness === "number" ? payload.avgRootSoilWetness : null);
  const longestDrySpell = analysis?.periodSummary.longestDrySpellDays ?? (typeof payload.longestDrySpellDays === "number" ? payload.longestDrySpellDays : 0);
  const heatStressDays = analysis?.periodSummary.heatStressDaysAbove35C ?? (typeof payload.heatStressDaysAbove35C === "number" ? payload.heatStressDaysAbove35C : 0);
  const dataGaps = [];
  if (soilPh === null || soilPh === void 0) dataGaps.push("Laboratory soil pH measurement is missing.");
  if (organicMatterPct === null || organicMatterPct === void 0) dataGaps.push("Soil organic matter (%) has not been tested.");
  if (currentCrops.length === 0) dataGaps.push("Current standing crop list is empty.");
  const alerts = [];
  if (longestDrySpell >= 14) {
    alerts.push(`Dry-spell alert: ${longestDrySpell} consecutive days < 1 mm rain observed in the regional NASA POWER grid.`);
  }
  if (heatStressDays >= 15) {
    alerts.push(`Thermal exposure: ${heatStressDays} days reached >= 35\xB0C, elevating flowering-stage heat sensitivity.`);
  }
  if (avgRootSoilWetness !== null && avgRootSoilWetness < 0.45) {
    alerts.push(`Subsoil moisture watch: Assimilated 0-100 cm wetness index averaged ${(avgRootSoilWetness * 100).toFixed(1)}%.`);
  }
  return {
    farmName,
    location,
    summary: [
      `FarmNova AI Edge Briefing for ${farmName}:`,
      totalRainMm !== null ? `\u2022 Observed Rainfall: ${totalRainMm} mm across the active NASA POWER window (longest dry spell: ${longestDrySpell} days).` : "\u2022 Observed Rainfall: Unavailable.",
      avgRootSoilWetness !== null ? `\u2022 Root-Zone Wetness (0\u2013100 cm): ${(avgRootSoilWetness * 100).toFixed(1)}% regional assimilated index (0.5\xB0 grid).` : "\u2022 Root-Zone Wetness: Unavailable.",
      strategies.length > 0 ? `\u2022 Evaluated Rotation Paths (${strategies.length}): ${strategies.map((s) => `${s.label} \u2014 ${s.title}`).join(" | ")}` : "\u2022 Rotation Paths: Evaluate cereal-legume alternation with local extension verification.",
      alerts.length > 0 ? `\u2022 Climate & Moisture Advisories:
  - ${alerts.join("\n  - ")}` : "\u2022 Climate & Moisture Advisories: Within nominal seasonal ranges for this window.",
      dataGaps.length > 0 ? `\u2022 Missing Local Field Evidence (Verify On-Site):
  - ${dataGaps.join("\n  - ")}` : "\u2022 Local Soil Inputs: Core soil pH and organic matter entries recorded; confirm spatial variability by walking the plot."
    ].join("\n"),
    alerts,
    dataGaps
  };
}
async function invokeSupabaseEdge(action, payload, context) {
  const { url, key, functionSlug, configured } = resolveSupabaseConfig();
  const farm = context?.farm ?? null;
  let analysis = context?.analysis ?? null;
  let strategies = context?.strategies ?? [];
  if (farm && (!analysis || strategies.length === 0) && (action === "rotation-brief" || action === "ai-advisor" || action === "nasa-telemetry")) {
    analysis = analysis ?? await fetchFarmEnvironmentalAnalysis(farm, false);
    if (strategies.length === 0 && context?.crops) {
      strategies = generateRotationStrategies(farm, analysis, context.crops);
    }
  }
  const enrichedPayload = {
    ...payload,
    ...farm ? {
      farmId: farm.id,
      farmName: farm.name,
      region: farm.region,
      country: farm.country,
      lat: farm.centroidLat,
      lon: farm.centroidLon,
      soilPh: farm.soilPh,
      organicMatterPct: farm.organicMatterPct,
      currentCrops: farm.currentCrops
    } : {},
    ...analysis ? {
      totalRainMm: analysis.periodSummary.totalRainMm,
      avgTempC: analysis.periodSummary.avgTempC,
      avgRootSoilWetness: analysis.periodSummary.avgRootSoilWetness,
      longestDrySpellDays: analysis.periodSummary.longestDrySpellDays,
      heatStressDaysAbove35C: analysis.periodSummary.heatStressDaysAbove35C
    } : {},
    ...strategies.length > 0 ? {
      strategies: strategies.map((s) => ({
        id: s.id,
        label: s.label,
        title: s.title,
        subtitle: s.subtitle
      }))
    } : {}
  };
  if (configured) {
    try {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const { data, error } = await supabase.functions.invoke(functionSlug, {
        body: { action, payload: enrichedPayload }
      });
      if (!error && data && typeof data === "object" && data.ok !== false) {
        return {
          ok: true,
          action,
          functionSlug,
          runtime: "supabase-edge",
          executedAt: data.executedAt || (/* @__PURE__ */ new Date()).toISOString(),
          data: data.data ?? data
        };
      }
    } catch {
    }
  }
  let localData;
  switch (action) {
    case "health":
      localData = {
        service: "FarmNova AI Edge",
        functionSlug,
        runtime: "local-edge-bridge",
        status: "healthy",
        supabaseConfigured: configured,
        supportedActions: ["health", "nasa-telemetry", "rotation-brief", "ai-advisor"],
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      break;
    case "nasa-telemetry": {
      if (analysis) {
        localData = {
          source: "NASA POWER + SRTM Elevation (Local Edge Bridge)",
          coordinates: analysis.coordinates,
          window: {
            start: analysis.periodSummary.startDate,
            end: analysis.periodSummary.endDate,
            daysObserved: analysis.dailySeries.length
          },
          elevationMeters: analysis.elevationMeters,
          totalRainMm: analysis.periodSummary.totalRainMm,
          avgTempC: analysis.periodSummary.avgTempC,
          heatStressDaysAbove35C: analysis.periodSummary.heatStressDaysAbove35C,
          avgRootSoilWetness: analysis.periodSummary.avgRootSoilWetness,
          longestDrySpellDays: analysis.periodSummary.longestDrySpellDays
        };
      } else {
        const lat = Number(enrichedPayload.lat ?? 7.3833);
        const lon = Number(enrichedPayload.lon ?? -1.3667);
        const tempFarm = {
          id: "edge-probe",
          ownerId: "edge",
          name: "Edge Probe",
          country: "",
          region: "",
          district: "",
          sizeHectares: 1,
          farmingType: "Probe",
          centroidLat: lat,
          centroidLon: lon,
          polygonCoords: [],
          soilType: "Unknown",
          soilTexture: "Unknown",
          drainage: "Unknown",
          soilFertility: "Unknown",
          organicMatterPct: null,
          soilPh: null,
          irrigationAvailable: "Unknown",
          soilNotes: "",
          previousCrops: [],
          currentCrops: [],
          plannedCrops: [],
          plantingSeasons: "",
          harvestPeriods: "",
          pestHistory: "",
          availableWater: "",
          equipmentNotes: "",
          marketPreferences: "",
          priorities: [],
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        const probeAnalysis = await fetchFarmEnvironmentalAnalysis(tempFarm, false);
        localData = {
          source: "NASA POWER + SRTM Elevation (Local Edge Bridge)",
          coordinates: probeAnalysis.coordinates,
          window: {
            start: probeAnalysis.periodSummary.startDate,
            end: probeAnalysis.periodSummary.endDate,
            daysObserved: probeAnalysis.dailySeries.length
          },
          elevationMeters: probeAnalysis.elevationMeters,
          totalRainMm: probeAnalysis.periodSummary.totalRainMm,
          avgTempC: probeAnalysis.periodSummary.avgTempC,
          heatStressDaysAbove35C: probeAnalysis.periodSummary.heatStressDaysAbove35C,
          avgRootSoilWetness: probeAnalysis.periodSummary.avgRootSoilWetness,
          longestDrySpellDays: probeAnalysis.periodSummary.longestDrySpellDays
        };
      }
      break;
    }
    case "rotation-brief":
      localData = buildLocalRotationBrief(farm, analysis, strategies, enrichedPayload);
      break;
    case "ai-advisor": {
      const question = String(enrichedPayload.question || "").trim();
      if (!question) {
        throw new Error("Question is required for ai-advisor.");
      }
      if (!farm || !analysis) {
        throw new Error("A registered farm context is required for ai-advisor.");
      }
      const res = await askAgriAssistant(farm, analysis, strategies, [], question);
      localData = { answer: res.answer, modelUsed: res.modelUsed };
      break;
    }
    default:
      throw new Error(`Unsupported Edge action: ${String(action)}`);
  }
  return {
    ok: true,
    action,
    functionSlug,
    runtime: "local-edge-bridge",
    executedAt: (/* @__PURE__ */ new Date()).toISOString(),
    data: localData
  };
}

// server.ts
initDatabase();
var __dirname = path2.dirname(fileURLToPath(import.meta.url));
var app = express();
app.use(express.json({ limit: "2mb" }));
var rateBuckets = /* @__PURE__ */ new Map();
function rateLimiter(maxPerMin) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path.split("/").slice(0, 3).join("/")}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + 6e4 });
      return next();
    }
    if (bucket.count >= maxPerMin) {
      return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    }
    bucket.count += 1;
    next();
  };
}
app.use("/api", rateLimiter(180));
function rowToUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    verified: Boolean(row.verified),
    organization: row.organization || "",
    region: row.region || "",
    preferredUnits: row.preferred_units || "metric",
    createdAt: row.created_at
  };
}
function rowToFarm(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    name: row.name,
    country: row.country,
    region: row.region,
    district: row.district,
    sizeHectares: Number(row.size_hectares),
    farmingType: row.farming_type,
    centroidLat: Number(row.centroid_lat),
    centroidLon: Number(row.centroid_lon),
    polygonCoords: JSON.parse(row.polygon_geojson || "[]"),
    soilType: row.soil_type,
    soilTexture: row.soil_texture,
    drainage: row.drainage,
    soilFertility: row.soil_fertility,
    organicMatterPct: row.organic_matter_pct !== null && row.organic_matter_pct !== void 0 ? Number(row.organic_matter_pct) : null,
    soilPh: row.soil_ph !== null && row.soil_ph !== void 0 ? Number(row.soil_ph) : null,
    irrigationAvailable: row.irrigation_available,
    soilNotes: row.soil_notes || "",
    previousCrops: JSON.parse(row.previous_crops_json || "[]"),
    currentCrops: JSON.parse(row.current_crops_json || "[]"),
    plannedCrops: JSON.parse(row.planned_crops_json || "[]"),
    plantingSeasons: row.planting_seasons,
    harvestPeriods: row.harvest_periods,
    pestHistory: row.pest_history || "",
    availableWater: row.available_water,
    equipmentNotes: row.equipment_notes || "",
    marketPreferences: row.market_preferences || "",
    priorities: JSON.parse(row.priorities_json || "[]"),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function rowToCrop(row) {
  return {
    id: row.id,
    name: row.name,
    scientificName: row.scientific_name,
    family: row.family,
    growingDurationDays: row.growing_duration_days,
    waterReqMm: row.water_req_mm,
    waterTier: row.water_tier,
    tempMinC: Number(row.temp_min_c),
    tempOptMinC: Number(row.temp_opt_min_c),
    tempOptMaxC: Number(row.temp_opt_max_c),
    tempMaxC: Number(row.temp_max_c),
    soilPreference: row.soil_preference,
    phMin: Number(row.ph_min),
    phMax: Number(row.ph_max),
    rootingDepthCm: row.rooting_depth_cm,
    rootingType: row.rooting_type,
    nutrientDemand: row.nutrient_demand,
    nitrogenFixingKgHa: Number(row.nitrogen_fixing_kg_ha),
    organicMatterContrib: row.organic_matter_contrib,
    foragePotential: row.forage_potential,
    pestDiseaseNotes: row.pest_disease_notes,
    suitableSeasons: row.suitable_seasons,
    compatiblePredecessors: JSON.parse(row.compatible_predecessors_json || "[]"),
    incompatiblePredecessors: JSON.parse(row.incompatible_predecessors_json || "[]"),
    regions: JSON.parse(row.regions_json || "[]"),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  };
}
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }
  const session = db.prepare(
    `SELECT s.token, s.expires_at, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.active = 1`
  ).get(token);
  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
  }
  req.user = rowToUser(session);
  req.token = token;
  next();
}
function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required." });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access restricted. Required role: ${roles.join(" or ")}.` });
    }
    next();
  };
}
function loadOwnedFarm(req, res) {
  const farmId = req.params.id;
  const row = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`).get(farmId);
  if (!row) {
    res.status(404).json({ error: "Farm not found." });
    return null;
  }
  if (row.owner_id !== req.user.id) {
    writeAuditLog(req.user.id, req.user.email, "UNAUTHORIZED_FARM_ACCESS_ATTEMPT", "farm", farmId, "Blocked cross-user farm access", req.ip);
    res.status(403).json({ error: "Access denied. You do not have permission to view or modify another farmer\u2019s private farm records." });
    return null;
  }
  return rowToFarm(row);
}
app.post("/api/auth/register", (req, res) => {
  const { email, password, name, role, organization, region } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Name, email, and password are required." });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }
  const assignedRole = "farmer";
  const id = crypto2.randomUUID();
  const verificationToken = crypto2.randomBytes(16).toString("hex");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, verified, verification_token, organization, region, preferred_units, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'metric', ?)`
  ).run(id, normalizedEmail, String(name).trim(), hashPassword(String(password)), assignedRole, verificationToken, organization || "", region || "", now);
  const sessionToken = generateToken();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
    sessionToken,
    id,
    Date.now() + 7 * 86400 * 1e3,
    now
  );
  writeAuditLog(id, normalizedEmail, "USER_REGISTERED", "user", id, `Role=${assignedRole}`, req.ip);
  const userRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  res.status(201).json({
    token: sessionToken,
    user: rowToUser(userRow),
    verificationToken,
    message: "Account created. Complete email verification using the issued verification code."
  });
});
app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail);
  if (!userRow || !verifyPassword(String(password), userRow.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  if (!userRow.active) {
    return res.status(403).json({ error: "This account has been deactivated by an administrator." });
  }
  const sessionToken = generateToken();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
    sessionToken,
    userRow.id,
    Date.now() + 7 * 86400 * 1e3,
    (/* @__PURE__ */ new Date()).toISOString()
  );
  writeAuditLog(userRow.id, normalizedEmail, "USER_LOGIN", "user", userRow.id, "Authenticated session issued", req.ip);
  res.json({ token: sessionToken, user: rowToUser(userRow) });
});
app.post("/api/auth/logout", requireAuth, (req, res) => {
  if (req.token) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.token);
  }
  writeAuditLog(req.user.id, req.user.email, "USER_LOGOUT", "user", req.user.id, "Session terminated", req.ip);
  res.json({ ok: true });
});
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
app.post("/api/auth/verify-email", (req, res) => {
  const { email, token } = req.body ?? {};
  if (!email || !token) return res.status(400).json({ error: "Email and verification code are required." });
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase());
  if (!userRow) return res.status(404).json({ error: "Account not found." });
  if (userRow.verified) return res.json({ verified: true, message: "Email is already verified." });
  if (userRow.verification_token !== String(token).trim()) {
    return res.status(400).json({ error: "Invalid verification code." });
  }
  db.prepare(`UPDATE users SET verified = 1, verification_token = NULL WHERE id = ?`).run(userRow.id);
  writeAuditLog(userRow.id, userRow.email, "EMAIL_VERIFIED", "user", userRow.id, "Email verification completed", req.ip);
  res.json({ verified: true, user: rowToUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(userRow.id)) });
});
app.post("/api/auth/resend-verification", requireAuth, (req, res) => {
  const verificationToken = crypto2.randomBytes(16).toString("hex");
  db.prepare(`UPDATE users SET verification_token = ? WHERE id = ?`).run(verificationToken, req.user.id);
  res.json({ verificationToken, message: "New email verification code generated." });
});
app.post("/api/auth/forgot-password", (req, res) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: "Email is required." });
  const normalizedEmail = String(email).trim().toLowerCase();
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail);
  if (!userRow) {
    return res.json({ message: "If an account matches this email, a recovery token has been issued." });
  }
  const resetToken = crypto2.randomBytes(12).toString("hex");
  const resetExpires = Date.now() + 3600 * 1e3;
  db.prepare(`UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?`).run(resetToken, resetExpires, userRow.id);
  writeAuditLog(userRow.id, normalizedEmail, "PASSWORD_RESET_REQUESTED", "user", userRow.id, "Recovery token generated", req.ip);
  res.json({
    message: "Password recovery token issued (valid for 1 hour).",
    demoRecoveryToken: resetToken
  });
});
app.post("/api/auth/reset-password", (req, res) => {
  const { email, token, newPassword } = req.body ?? {};
  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: "Email, recovery token, and new password are required." });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase());
  if (!userRow || userRow.reset_token !== String(token).trim() || !userRow.reset_expires || userRow.reset_expires < Date.now()) {
    return res.status(400).json({ error: "Invalid or expired recovery token." });
  }
  db.prepare(`UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?`).run(
    hashPassword(String(newPassword)),
    userRow.id
  );
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userRow.id);
  writeAuditLog(userRow.id, userRow.email, "PASSWORD_RESET_COMPLETED", "user", userRow.id, "Password updated", req.ip);
  res.json({ ok: true, message: "Password updated successfully. Please sign in." });
});
app.put("/api/auth/profile", requireAuth, (req, res) => {
  const { name, organization, region, preferredUnits } = req.body ?? {};
  db.prepare(`UPDATE users SET name = ?, organization = ?, region = ?, preferred_units = ? WHERE id = ?`).run(
    String(name || req.user.name).trim(),
    String(organization ?? req.user.organization).trim(),
    String(region ?? req.user.region).trim(),
    preferredUnits === "imperial" ? "imperial" : "metric",
    req.user.id
  );
  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  writeAuditLog(req.user.id, req.user.email, "PROFILE_UPDATED", "user", req.user.id, "Updated user profile settings", req.ip);
  res.json({ user: rowToUser(updated) });
});
app.get("/api/announcements", (_req, res) => {
  const rows = db.prepare(`SELECT * FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 5`).all();
  res.json({
    announcements: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      severity: r.severity,
      active: Boolean(r.active),
      createdBy: r.created_by,
      createdAt: r.created_at
    }))
  });
});
app.get("/api/farms", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.owner_id = ? ORDER BY f.updated_at DESC`).all(req.user.id);
  res.json({ farms: rows.map(rowToFarm) });
});
app.post("/api/farms", requireAuth, (req, res) => {
  const body = req.body ?? {};
  if (!body.name || !body.country || !body.region || !body.centroidLat || !body.centroidLon) {
    return res.status(400).json({ error: "Farm name, location, and geographic coordinates are required." });
  }
  const id = `farm-${crypto2.randomUUID().slice(0, 8)}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `INSERT INTO farms (
      id, owner_id, name, country, region, district, size_hectares, farming_type,
      centroid_lat, centroid_lon, polygon_geojson, soil_type, soil_texture, drainage,
      soil_fertility, organic_matter_pct, soil_ph, irrigation_available, soil_notes,
      previous_crops_json, current_crops_json, planned_crops_json, planting_seasons,
      harvest_periods, pest_history, available_water, equipment_notes, market_preferences,
      priorities_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    req.user.id,
    String(body.name).trim(),
    String(body.country).trim(),
    String(body.region).trim(),
    String(body.district || "").trim(),
    Number(body.sizeHectares) || 1,
    String(body.farmingType || "Mixed rainfed smallholder"),
    Number(body.centroidLat),
    Number(body.centroidLon),
    JSON.stringify(body.polygonCoords || []),
    String(body.soilType || "Unknown"),
    String(body.soilTexture || "Unknown"),
    String(body.drainage || "Unknown"),
    String(body.soilFertility || "Unknown"),
    body.organicMatterPct !== null && body.organicMatterPct !== void 0 && body.organicMatterPct !== "" ? Number(body.organicMatterPct) : null,
    body.soilPh !== null && body.soilPh !== void 0 && body.soilPh !== "" ? Number(body.soilPh) : null,
    String(body.irrigationAvailable || "None (rainfed)"),
    String(body.soilNotes || ""),
    JSON.stringify(Array.isArray(body.previousCrops) ? body.previousCrops : []),
    JSON.stringify(Array.isArray(body.currentCrops) ? body.currentCrops : []),
    JSON.stringify(Array.isArray(body.plannedCrops) ? body.plannedCrops : []),
    String(body.plantingSeasons || "Main rainy season"),
    String(body.harvestPeriods || "End of rainy season"),
    String(body.pestHistory || ""),
    String(body.availableWater || "Rainfed"),
    String(body.equipmentNotes || ""),
    String(body.marketPreferences || ""),
    JSON.stringify(Array.isArray(body.priorities) ? body.priorities : []),
    now,
    now
  );
  writeAuditLog(req.user.id, req.user.email, "FARM_CREATED", "farm", id, `Registered farm "${body.name}"`, req.ip);
  const created = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`).get(id);
  res.status(201).json({ farm: rowToFarm(created) });
});
app.put("/api/farms/:id", requireAuth, (req, res) => {
  const existing = loadOwnedFarm(req, res);
  if (!existing) return;
  const body = req.body ?? {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `UPDATE farms SET
      name = ?, country = ?, region = ?, district = ?, size_hectares = ?, farming_type = ?,
      centroid_lat = ?, centroid_lon = ?, polygon_geojson = ?, soil_type = ?, soil_texture = ?,
      drainage = ?, soil_fertility = ?, organic_matter_pct = ?, soil_ph = ?, irrigation_available = ?,
      soil_notes = ?, previous_crops_json = ?, current_crops_json = ?, planned_crops_json = ?,
      planting_seasons = ?, harvest_periods = ?, pest_history = ?, available_water = ?,
      equipment_notes = ?, market_preferences = ?, priorities_json = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`
  ).run(
    String(body.name ?? existing.name),
    String(body.country ?? existing.country),
    String(body.region ?? existing.region),
    String(body.district ?? existing.district),
    Number(body.sizeHectares ?? existing.sizeHectares),
    String(body.farmingType ?? existing.farmingType),
    Number(body.centroidLat ?? existing.centroidLat),
    Number(body.centroidLon ?? existing.centroidLon),
    JSON.stringify(body.polygonCoords ?? existing.polygonCoords),
    String(body.soilType ?? existing.soilType),
    String(body.soilTexture ?? existing.soilTexture),
    String(body.drainage ?? existing.drainage),
    String(body.soilFertility ?? existing.soilFertility),
    body.organicMatterPct !== void 0 ? body.organicMatterPct === null || body.organicMatterPct === "" ? null : Number(body.organicMatterPct) : existing.organicMatterPct,
    body.soilPh !== void 0 ? body.soilPh === null || body.soilPh === "" ? null : Number(body.soilPh) : existing.soilPh,
    String(body.irrigationAvailable ?? existing.irrigationAvailable),
    String(body.soilNotes ?? existing.soilNotes),
    JSON.stringify(body.previousCrops ?? existing.previousCrops),
    JSON.stringify(body.currentCrops ?? existing.currentCrops),
    JSON.stringify(body.plannedCrops ?? existing.plannedCrops),
    String(body.plantingSeasons ?? existing.plantingSeasons),
    String(body.harvestPeriods ?? existing.harvestPeriods),
    String(body.pestHistory ?? existing.pestHistory),
    String(body.availableWater ?? existing.availableWater),
    String(body.equipmentNotes ?? existing.equipmentNotes),
    String(body.marketPreferences ?? existing.marketPreferences),
    JSON.stringify(body.priorities ?? existing.priorities),
    now,
    existing.id,
    req.user.id
  );
  writeAuditLog(req.user.id, req.user.email, "FARM_UPDATED", "farm", existing.id, `Updated farm "${body.name ?? existing.name}"`, req.ip);
  const updated = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`).get(existing.id);
  res.json({ farm: rowToFarm(updated) });
});
app.delete("/api/farms/:id", requireAuth, (req, res) => {
  const existing = loadOwnedFarm(req, res);
  if (!existing) return;
  db.prepare(`DELETE FROM farms WHERE id = ? AND owner_id = ?`).run(existing.id, req.user.id);
  writeAuditLog(req.user.id, req.user.email, "FARM_DELETED", "farm", existing.id, `Deleted farm "${existing.name}"`, req.ip);
  res.json({ ok: true });
});
app.get("/api/farms/:id/analysis", requireAuth, async (req, res) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  try {
    const forceRefresh = req.query.refresh === "1";
    const analysis = await fetchFarmEnvironmentalAnalysis(farm, forceRefresh);
    const cropRows = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all();
    const crops = cropRows.map(rowToCrop);
    const strategies = generateRotationStrategies(farm, analysis, crops);
    res.json({ farm, analysis, strategies });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Failed to retrieve NASA environmental analysis." });
  }
});
app.post("/api/farms/:id/scenario", requireAuth, async (req, res) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  try {
    const params = {
      rainfallChangePct: Number(req.body?.rainfallChangePct ?? 0),
      tempShiftC: Number(req.body?.tempShiftC ?? 0),
      extraHeatStressDays: Number(req.body?.extraHeatStressDays ?? 0),
      waterAvailabilityDropPct: Number(req.body?.waterAvailabilityDropPct ?? 0),
      extremeRainIntensity: req.body?.extremeRainIntensity ?? "baseline"
    };
    const analysis = await fetchFarmEnvironmentalAnalysis(farm, false);
    const crops = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all().map(rowToCrop);
    const strategies = generateRotationStrategies(farm, analysis, crops);
    const simulation = simulateClimateScenarios(farm, analysis, strategies, params);
    res.json({ simulation });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Scenario simulation failed." });
  }
});
app.get("/api/farms/:id/chat", requireAuth, (req, res) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  const rows = db.prepare(`SELECT id, farm_id, role, content, created_at FROM chat_messages WHERE farm_id = ? AND user_id = ? ORDER BY created_at ASC`).all(farm.id, req.user.id);
  res.json({
    messages: rows.map((r) => ({
      id: r.id,
      farmId: r.farm_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at
    }))
  });
});
app.post("/api/farms/:id/chat", requireAuth, rateLimiter(30), async (req, res) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Question cannot be empty." });
  try {
    const analysis = await fetchFarmEnvironmentalAnalysis(farm, false);
    const crops = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all().map(rowToCrop);
    const strategies = generateRotationStrategies(farm, analysis, crops);
    const historyRows = db.prepare(`SELECT id, farm_id, role, content, created_at FROM chat_messages WHERE farm_id = ? AND user_id = ? ORDER BY created_at ASC`).all(farm.id, req.user.id);
    const history = historyRows.map((r) => ({
      id: r.id,
      farmId: r.farm_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at
    }));
    const { answer, modelUsed } = await askAgriAssistant(farm, analysis, strategies, history, message);
    const userMsgId = crypto2.randomUUID();
    const asstMsgId = crypto2.randomUUID();
    const now1 = (/* @__PURE__ */ new Date()).toISOString();
    const now2 = new Date(Date.now() + 10).toISOString();
    const insertChat = db.prepare(`INSERT INTO chat_messages (id, farm_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    insertChat.run(userMsgId, farm.id, req.user.id, "user", message, now1);
    insertChat.run(asstMsgId, farm.id, req.user.id, "assistant", answer, now2);
    writeAuditLog(req.user.id, req.user.email, "AI_ASSISTANT_QUERY", "farm", farm.id, `Model=${modelUsed}`, req.ip);
    res.json({
      userMessage: { id: userMsgId, farmId: farm.id, role: "user", content: message, createdAt: now1 },
      assistantMessage: { id: asstMsgId, farmId: farm.id, role: "assistant", content: answer, createdAt: now2 }
    });
  } catch (err) {
    res.status(502).json({ error: err?.message || "AI Assistant could not complete the request." });
  }
});
app.delete("/api/farms/:id/chat", requireAuth, (req, res) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  db.prepare(`DELETE FROM chat_messages WHERE farm_id = ? AND user_id = ?`).run(farm.id, req.user.id);
  res.json({ ok: true });
});
app.get("/api/farms/:id/export/csv", requireAuth, async (req, res) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  const analysis = await fetchFarmEnvironmentalAnalysis(farm, false);
  const crops = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all().map(rowToCrop);
  const strategies = generateRotationStrategies(farm, analysis, crops);
  const lines = [];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  lines.push("SECTION,KEY,VALUE,NOTES");
  lines.push(`Farm,${esc("Name")},${esc(farm.name)},${esc(`${farm.district}, ${farm.region}, ${farm.country}`)}`);
  lines.push(`Farm,${esc("Coordinates")},${esc(`${farm.centroidLat}, ${farm.centroidLon}`)},${esc(`${farm.sizeHectares} ha | ${farm.farmingType}`)}`);
  lines.push(`Farm,${esc("Soil Profile")},${esc(`${farm.soilType} (${farm.soilTexture})`)},${esc(`pH=${farm.soilPh ?? "Unknown"}, OM=${farm.organicMatterPct ?? "Unknown"}%`)}`);
  lines.push(`Climate,${esc("Observed Period")},${esc(`${analysis.periodSummary.startDate} to ${analysis.periodSummary.endDate}`)},NASA POWER / GPM Heritage`);
  lines.push(`Climate,${esc("Total Rainfall (mm)")},${esc(analysis.periodSummary.totalRainMm)},${esc(`Longest dry spell: ${analysis.periodSummary.longestDrySpellDays} days`)}`);
  lines.push(`Climate,${esc("Mean Temp (C)")},${esc(analysis.periodSummary.avgTempC)},${esc(`Heat days >=35C: ${analysis.periodSummary.heatStressDaysAbove35C}`)}`);
  lines.push(`Terrain,${esc("SRTM Elevation / Slope")},${esc(`${analysis.elevationMeters ?? "N/A"} m`)},${esc(`Slope ${analysis.terrainSlopePct ?? "N/A"}%`)}`);
  lines.push("");
  lines.push("STRATEGY,TITLE,SEQUENCE,INDICATORS_SUMMARY");
  for (const s of strategies) {
    lines.push(
      `${esc(s.label)},${esc(s.title)},${esc(s.steps.map((st) => `${st.seasonLabel}: ${st.cropName}`).join(" -> "))},${esc(
        s.indicators.map((i) => `${i.indicator}: ${i.rating}`).join("; ")
      )}`
    );
  }
  lines.push("");
  lines.push("DAILY_DATE,TEMP_MEAN_C,TEMP_MAX_C,PRECIP_MM,SOIL_WETNESS_TOP,SOIL_WETNESS_ROOT,ET0_MM");
  for (const d of analysis.dailySeries) {
    lines.push(`${d.date},${d.tempMeanC ?? ""},${d.tempMaxC ?? ""},${d.precipMm ?? ""},${d.soilMoistureTop ?? ""},${d.soilMoistureRoot ?? ""},${d.et0Mm ?? ""}`);
  }
  writeAuditLog(req.user.id, req.user.email, "EXPORT_CSV_REPORT", "farm", farm.id, "Generated CSV environmental & rotation report", req.ip);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${farm.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-farmnova-report.csv"`);
  res.send(lines.join("\n"));
});
app.get("/api/edge/status", requireAuth, (_req, res) => {
  res.json(getSupabaseEdgeStatus());
});
app.post("/api/edge/invoke", requireAuth, rateLimiter(30), async (req, res) => {
  const action = String(req.body?.action || "health");
  const allowedActions = ["health", "nasa-telemetry", "rotation-brief", "ai-advisor"];
  if (!allowedActions.includes(action)) {
    return res.status(400).json({ error: `Unsupported Edge Function action: ${action}` });
  }
  const rawPayload = req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {};
  const requestedFarmId = String(req.body?.farmId || rawPayload.farmId || "").trim();
  let ownedFarm = null;
  if (requestedFarmId) {
    const row = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`).get(requestedFarmId);
    if (!row) {
      return res.status(404).json({ error: "Farm not found." });
    }
    if (row.owner_id !== req.user.id) {
      writeAuditLog(req.user.id, req.user.email, "UNAUTHORIZED_EDGE_FARM_ACCESS", "farm", requestedFarmId, "Blocked cross-user edge access", req.ip);
      return res.status(403).json({ error: "Access denied for requested farm boundary." });
    }
    ownedFarm = rowToFarm(row);
  }
  try {
    const crops = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all().map(rowToCrop);
    const result = await invokeSupabaseEdge(action, rawPayload, { farm: ownedFarm, crops });
    writeAuditLog(
      req.user.id,
      req.user.email,
      "EDGE_FUNCTION_INVOKED",
      "edge_function",
      result.functionSlug,
      `action=${action}, runtime=${result.runtime}`,
      req.ip
    );
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err?.message || "Supabase Edge Function execution failed." });
  }
});
app.get("/api/crops", requireAuth, (_req, res) => {
  const rows = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all();
  res.json({ crops: rows.map(rowToCrop) });
});
app.post("/api/crops", requireAuth, requireRoles("expert", "admin"), (req, res) => {
  const b = req.body ?? {};
  if (!b.name || !b.scientificName || !b.family) {
    return res.status(400).json({ error: "Crop name, scientific name, and family are required." });
  }
  const id = String(b.id || b.name).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `INSERT INTO crops (
      id, name, scientific_name, family, growing_duration_days, water_req_mm, water_tier,
      temp_min_c, temp_opt_min_c, temp_opt_max_c, temp_max_c, soil_preference, ph_min, ph_max,
      rooting_depth_cm, rooting_type, nutrient_demand, nitrogen_fixing_kg_ha, organic_matter_contrib,
      forage_potential, pest_disease_notes, suitable_seasons, compatible_predecessors_json,
      incompatible_predecessors_json, regions_json, updated_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    b.name,
    b.scientificName,
    b.family,
    b.growingDurationDays || "90\u2013120 days",
    b.waterReqMm || "400\u2013600 mm",
    b.waterTier || "Moderate",
    Number(b.tempMinC ?? 14),
    Number(b.tempOptMinC ?? 22),
    Number(b.tempOptMaxC ?? 32),
    Number(b.tempMaxC ?? 38),
    b.soilPreference || "Well-drained loam",
    Number(b.phMin ?? 5.5),
    Number(b.phMax ?? 7.2),
    b.rootingDepthCm || "60\u2013120 cm",
    b.rootingType || "Taproot/fibrous",
    b.nutrientDemand || "Moderate",
    Number(b.nitrogenFixingKgHa ?? 0),
    b.organicMatterContrib || "Moderate",
    b.foragePotential || "Moderate crop residue",
    b.pestDiseaseNotes || "Monitor local pests.",
    b.suitableSeasons || "Main rainy season",
    JSON.stringify(Array.isArray(b.compatiblePredecessors) ? b.compatiblePredecessors : []),
    JSON.stringify(Array.isArray(b.incompatiblePredecessors) ? b.incompatiblePredecessors : []),
    JSON.stringify(Array.isArray(b.regions) ? b.regions : ["West Africa", "East Africa"]),
    req.user.email,
    now
  );
  writeAuditLog(req.user.id, req.user.email, "CROP_CREATED", "crop", id, `Added crop ${b.name}`, req.ip);
  const created = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(id);
  res.status(201).json({ crop: rowToCrop(created) });
});
app.put("/api/crops/:id", requireAuth, requireRoles("expert", "admin"), (req, res) => {
  const existing = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Crop not found." });
  const b = req.body ?? {};
  const now = (/* @__PURE__ */ new Date()).toISOString();
  db.prepare(
    `UPDATE crops SET
      name = ?, scientific_name = ?, family = ?, growing_duration_days = ?, water_req_mm = ?,
      water_tier = ?, temp_min_c = ?, temp_opt_min_c = ?, temp_opt_max_c = ?, temp_max_c = ?,
      soil_preference = ?, ph_min = ?, ph_max = ?, rooting_depth_cm = ?, rooting_type = ?,
      nutrient_demand = ?, nitrogen_fixing_kg_ha = ?, organic_matter_contrib = ?, forage_potential = ?,
      pest_disease_notes = ?, suitable_seasons = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    b.name ?? existing.name,
    b.scientificName ?? existing.scientific_name,
    b.family ?? existing.family,
    b.growingDurationDays ?? existing.growing_duration_days,
    b.waterReqMm ?? existing.water_req_mm,
    b.waterTier ?? existing.water_tier,
    Number(b.tempMinC ?? existing.temp_min_c),
    Number(b.tempOptMinC ?? existing.temp_opt_min_c),
    Number(b.tempOptMaxC ?? existing.temp_opt_max_c),
    Number(b.tempMaxC ?? existing.temp_max_c),
    b.soilPreference ?? existing.soil_preference,
    Number(b.phMin ?? existing.ph_min),
    Number(b.phMax ?? existing.ph_max),
    b.rootingDepthCm ?? existing.rooting_depth_cm,
    b.rootingType ?? existing.rooting_type,
    b.nutrientDemand ?? existing.nutrient_demand,
    Number(b.nitrogenFixingKgHa ?? existing.nitrogen_fixing_kg_ha),
    b.organicMatterContrib ?? existing.organic_matter_contrib,
    b.foragePotential ?? existing.forage_potential,
    b.pestDiseaseNotes ?? existing.pest_disease_notes,
    b.suitableSeasons ?? existing.suitable_seasons,
    req.user.email,
    now,
    req.params.id
  );
  writeAuditLog(req.user.id, req.user.email, "CROP_UPDATED", "crop", req.params.id, `Updated ${b.name ?? existing.name}`, req.ip);
  const updated = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(req.params.id);
  res.json({ crop: rowToCrop(updated) });
});
app.delete("/api/crops/:id", requireAuth, requireRoles("admin"), (req, res) => {
  db.prepare(`DELETE FROM crops WHERE id = ?`).run(req.params.id);
  writeAuditLog(req.user.id, req.user.email, "CROP_DELETED", "crop", req.params.id, "Removed crop entry", req.ip);
  res.json({ ok: true });
});
app.get("/api/admin/overview", requireAuth, requireRoles("admin"), (_req, res) => {
  const users = db.prepare(`SELECT id, email, name, role, verified, organization, region, active, created_at FROM users ORDER BY created_at DESC`).all();
  const farms = db.prepare(`SELECT id, name, country, region, district, size_hectares, farming_type, centroid_lat, centroid_lon, created_at FROM farms ORDER BY created_at DESC`).all();
  const datasets = db.prepare(`SELECT * FROM dataset_configs`).all();
  const aiSettings = db.prepare(`SELECT * FROM ai_settings WHERE id = 'default'`).get();
  const announcements = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all();
  const auditLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80`).all();
  const cacheCount = db.prepare(`SELECT COUNT(*) as c FROM nasa_cache`).get().c;
  const chatCount = db.prepare(`SELECT COUNT(*) as c FROM chat_messages`).get().c;
  const cropCount = db.prepare(`SELECT COUNT(*) as c FROM crops`).get().c;
  res.json({
    health: {
      database: "SQLite WAL Connected",
      nasaPowerEndpoint: "https://power.larc.nasa.gov/api",
      cachedGeospatialQueries: cacheCount,
      totalChatInteractions: chatCount,
      cropCatalogCount: cropCount,
      uptimeSeconds: Math.floor(process.uptime())
    },
    users,
    farms,
    datasets,
    aiSettings,
    announcements,
    auditLogs
  });
});
app.put("/api/admin/users/:id", requireAuth, requireRoles("admin"), (req, res) => {
  const { role, verified, active } = req.body ?? {};
  const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found." });
  db.prepare(`UPDATE users SET role = ?, verified = ?, active = ? WHERE id = ?`).run(
    role ?? target.role,
    verified !== void 0 ? verified ? 1 : 0 : target.verified,
    active !== void 0 ? active ? 1 : 0 : target.active,
    req.params.id
  );
  writeAuditLog(req.user.id, req.user.email, "ADMIN_USER_UPDATED", "user", req.params.id, `role=${role ?? target.role}, active=${active ?? target.active}`, req.ip);
  res.json({ ok: true });
});
app.put("/api/admin/datasets/:id", requireAuth, requireRoles("admin"), (req, res) => {
  const { enabled, limitations, processingMethod } = req.body ?? {};
  const target = db.prepare(`SELECT * FROM dataset_configs WHERE id = ?`).get(req.params.id);
  if (!target) return res.status(404).json({ error: "Dataset configuration not found." });
  db.prepare(`UPDATE dataset_configs SET enabled = ?, limitations = ?, processing_method = ? WHERE id = ?`).run(
    enabled !== void 0 ? enabled ? 1 : 0 : target.enabled,
    limitations ?? target.limitations,
    processingMethod ?? target.processing_method,
    req.params.id
  );
  writeAuditLog(req.user.id, req.user.email, "ADMIN_DATASET_UPDATED", "dataset", req.params.id, `enabled=${enabled}`, req.ip);
  res.json({ ok: true });
});
app.put("/api/admin/ai-settings", requireAuth, requireRoles("admin"), (req, res) => {
  const { modelName, systemTone, strictScientificDisclaimer, maxHistoryTurns } = req.body ?? {};
  const allowedModels = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"];
  const safeModel = allowedModels.includes(modelName) ? modelName : "gemini-4-hydrogen";
  db.prepare(
    `UPDATE ai_settings SET model_name = ?, system_tone = ?, strict_scientific_disclaimer = ?, max_history_turns = ?, updated_at = ? WHERE id = 'default'`
  ).run(
    safeModel,
    String(systemTone || "Practical, respectful agronomic advisor grounded in empirical observation"),
    strictScientificDisclaimer ? 1 : 0,
    Math.min(24, Math.max(4, Number(maxHistoryTurns || 12))),
    (/* @__PURE__ */ new Date()).toISOString()
  );
  writeAuditLog(req.user.id, req.user.email, "ADMIN_AI_SETTINGS_UPDATED", "ai_settings", "default", `model=${safeModel}`, req.ip);
  res.json({ ok: true });
});
app.post("/api/admin/announcements", requireAuth, requireRoles("admin"), (req, res) => {
  const { title, body, severity } = req.body ?? {};
  if (!title || !body) return res.status(400).json({ error: "Announcement title and body are required." });
  const id = `ann-${crypto2.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO announcements (id, title, body, severity, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)`).run(
    id,
    String(title).trim(),
    String(body).trim(),
    severity || "info",
    req.user.name,
    (/* @__PURE__ */ new Date()).toISOString()
  );
  writeAuditLog(req.user.id, req.user.email, "ANNOUNCEMENT_CREATED", "announcement", id, title, req.ip);
  res.status(201).json({ ok: true });
});
app.delete("/api/admin/announcements/:id", requireAuth, requireRoles("admin"), (req, res) => {
  db.prepare(`DELETE FROM announcements WHERE id = ?`).run(req.params.id);
  writeAuditLog(req.user.id, req.user.email, "ANNOUNCEMENT_DELETED", "announcement", req.params.id, "Removed announcement", req.ip);
  res.json({ ok: true });
});
app.post("/api/admin/cache/clear", requireAuth, requireRoles("admin"), (req, res) => {
  db.prepare(`DELETE FROM nasa_cache`).run();
  writeAuditLog(req.user.id, req.user.email, "NASA_CACHE_CLEARED", "cache", "all", "Cleared cached NASA POWER/SRTM responses", req.ip);
  res.json({ ok: true });
});
async function startServer() {
  const port = Number(process.env.PORT || 3e3);
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path2.join(distPath, "index.html"));
    });
  }
  app.listen(port, "0.0.0.0", () => {
    console.log(`FarmNova AI server running on http://0.0.0.0:${port}`);
  });
}
startServer();
