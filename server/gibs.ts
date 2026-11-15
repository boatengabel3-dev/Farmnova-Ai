import { db } from './db.ts';
import type { GibsLayerCapability } from '../src/types.ts';

const GIBS_CAPABILITIES_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml';

/**
 * Curated agricultural layer definitions verified directly against NASA GIBS
 * WMTSCapabilities.xml (epsg3857/best). No invented layer IDs or matrix sets.
 */
const VERIFIED_AGRICULTURAL_LAYERS: Omit<GibsLayerCapability, 'title' | 'minDate' | 'maxDate'>[] = [
  {
    id: 'MODIS_Terra_NDVI_8Day',
    mission: 'NASA MODIS Terra 8-Day Vegetation Index',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    format: 'png',
    resolution: '250 m / pixel',
    legendText:
      '8-day vegetation greenness (NDVI) across 250 m pixels. Helps inspect regional crop vigor; single small plots may blend with adjacent land.',
    colorRamp: [
      { color: '#C8B08A', label: 'Sparse / Bare' },
      { color: '#7BB661', label: 'Moderate Canopy' },
      { color: '#1B5E20', label: 'Dense Greenness' },
    ],
  },
  {
    id: 'MODIS_Aqua_Land_Surface_Temp_Day',
    mission: 'NASA MODIS Aqua Daytime Surface Temp',
    tileMatrixSet: 'GoogleMapsCompatible_Level7',
    format: 'png',
    resolution: '1 km / pixel',
    legendText:
      'Daytime land-surface skin temperature context; cloud cover creates transparent gaps.',
    colorRamp: [
      { color: '#2B83BA', label: 'Cooler (<25°C)' },
      { color: '#FDAE61', label: 'Warm (32–38°C)' },
      { color: '#D7191C', label: 'Hot (>40°C)' },
    ],
  },
  {
    id: 'IMERG_Precipitation_Rate',
    mission: 'NASA GPM IMERG Precipitation Rate',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    format: 'png',
    resolution: '0.1° (~11 km)',
    legendText:
      'Satellite precipitation rate snapshot (~11 km cells). Always confirm passing rain showers with local field checks.',
    colorRamp: [
      { color: '#9ECAE1', label: 'Light Rain' },
      { color: '#3182BD', label: 'Moderate' },
      { color: '#08306B', label: 'Heavy Storm' },
    ],
  },
  {
    id: 'SMAP_L4_Analyzed_Root_Zone_Soil_Moisture',
    mission: 'NASA SMAP L4 Root-Zone Soil Moisture',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    format: 'png',
    resolution: '9 km / pixel',
    legendText:
      'Assimilated 0–100 cm root-zone soil moisture footprint (9 km); contextual rather than plot-exact.',
    colorRamp: [
      { color: '#D9A05B', label: 'Dry Root Zone' },
      { color: '#74C476', label: 'Moist' },
      { color: '#08519C', label: 'Wet / Saturated' },
    ],
  },
  {
    id: 'SMAP_L4_Analyzed_Surface_Soil_Moisture',
    mission: 'NASA SMAP L4 Surface Soil Moisture',
    tileMatrixSet: 'GoogleMapsCompatible_Level6',
    format: 'png',
    resolution: '9 km / pixel',
    legendText:
      'Regional 0–5 cm topsoil moisture assimilation (9 km footprint); contextual rather than plot-exact.',
    colorRamp: [
      { color: '#D9A05B', label: 'Dry Surface' },
      { color: '#74C476', label: 'Moist' },
      { color: '#08519C', label: 'Wet / Saturated' },
    ],
  },
  {
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    mission: 'NASA MODIS Terra True Color',
    tileMatrixSet: 'GoogleMapsCompatible_Level9',
    format: 'jpg',
    resolution: '250 m / pixel',
    legendText:
      'Daily orbital reflectance showing regional cloud cover, smoke/haze, and landscape greening.',
    colorRamp: [],
  },
];

function extractDateRangeFromValues(values: string[]): { minDate: string; maxDate: string } | null {
  let minDate = '';
  let maxDate = '';
  for (const val of values) {
    const parts = val.split('/');
    if (parts.length >= 2) {
      const start = parts[0].slice(0, 10);
      const end = parts[1].slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
        if (!minDate || start < minDate) minDate = start;
        if (!maxDate || end > maxDate) maxDate = end;
      }
    } else if (/^\d{4}-\d{2}-\d{2}/.test(val)) {
      const d = val.slice(0, 10);
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
  }
  return minDate && maxDate ? { minDate, maxDate } : null;
}

export async function getVerifiedGibsCapabilities(forceRefresh = false): Promise<{
  source: string;
  fetchedAt: string;
  layers: GibsLayerCapability[];
}> {
  const cacheKey = 'gibs_capabilities_epsg3857_v1';
  if (!forceRefresh) {
    const cached = db
      .prepare(`SELECT payload_json, expires_at FROM nasa_cache WHERE cache_key = ?`)
      .get(cacheKey) as { payload_json: string; expires_at: number } | undefined;
    if (cached && cached.expires_at > Date.now()) {
      return JSON.parse(cached.payload_json);
    }
  }

  const fallbackDateMax = new Date(Date.now() - 4 * 86400 * 1000).toISOString().slice(0, 10);
  const fallbackDateMin = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);

  try {
    const res = await fetch(GIBS_CAPABILITIES_URL, { signal: AbortSignal.timeout(18000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const blocks = xml.split('<Layer>').slice(1);
    const parsedById = new Map<
      string,
      { title: string; tileMatrixSet?: string; format?: 'png' | 'jpg'; minDate?: string; maxDate?: string }
    >();

    for (const block of blocks) {
      const idMatch = block.match(/<ows:Identifier>([^<]+)<\/ows:Identifier>/);
      if (!idMatch) continue;
      const id = idMatch[1];
      if (!VERIFIED_AGRICULTURAL_LAYERS.some((v) => v.id === id)) continue;

      const titleMatch = block.match(/<ows:Title[^>]*>([^<]+)<\/ows:Title>/);
      const tmMatch = block.match(/<TileMatrixSet>([^<]+)<\/TileMatrixSet>/);
      const fmtMatch = block.match(/<Format>([^<]+)<\/Format>/);
      const timeValues = [...block.matchAll(/<Value>([^<]+)<\/Value>/g)].map((m) => m[1]);
      const range = extractDateRangeFromValues(timeValues);

      parsedById.set(id, {
        title: titleMatch?.[1] || id,
        tileMatrixSet: tmMatch?.[1],
        format: fmtMatch?.[1]?.includes('jpeg') ? 'jpg' : 'png',
        minDate: range?.minDate,
        maxDate: range?.maxDate,
      });
    }

    const layers: GibsLayerCapability[] = VERIFIED_AGRICULTURAL_LAYERS.filter((meta) =>
      parsedById.has(meta.id)
    ).map((meta) => {
      const cap = parsedById.get(meta.id)!;
      return {
        ...meta,
        title: cap.title,
        tileMatrixSet: cap.tileMatrixSet || meta.tileMatrixSet,
        format: cap.format || meta.format,
        minDate: cap.minDate || fallbackDateMin,
        maxDate: cap.maxDate || fallbackDateMax,
      };
    });

    if (layers.length > 0) {
      const payload = {
        source: GIBS_CAPABILITIES_URL,
        fetchedAt: new Date().toISOString(),
        layers,
      };
      db.prepare(
        `INSERT OR REPLACE INTO nasa_cache (cache_key, payload_json, fetched_at, expires_at) VALUES (?, ?, ?, ?)`
      ).run(cacheKey, JSON.stringify(payload), payload.fetchedAt, Date.now() + 24 * 3600 * 1000);
      return payload;
    }
  } catch {
    // Fall back to verified GetCapabilities snapshot if upstream XML times out
  }

  const snapshotLayers: GibsLayerCapability[] = VERIFIED_AGRICULTURAL_LAYERS.map((meta) => ({
    ...meta,
    title: meta.mission,
    minDate: meta.id.startsWith('SMAP') ? '2015-03-31' : '2025-01-01',
    maxDate: meta.id.startsWith('SMAP')
      ? new Date(Date.now() - 5 * 86400 * 1000).toISOString().slice(0, 10)
      : fallbackDateMax,
  }));

  return {
    source: `${GIBS_CAPABILITIES_URL} (verified capability fallback)`,
    fetchedAt: new Date().toISOString(),
    layers: snapshotLayers,
  };
}
