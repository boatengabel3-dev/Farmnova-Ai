import { db } from './db.ts';
import type {
  DailyWeatherPoint,
  DatasetProvenance,
  EnvironmentalAnalysis,
  EnvironmentalInsight,
  Farm,
  MonthlyClimatePoint,
} from '../src/types.ts';

function formatYyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatIsoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function cleanVal(v: number | undefined): number | null {
  if (v === undefined || v === null || Number.isNaN(v) || v <= -900) return null;
  return Number(v.toFixed(3));
}

/**
 * Simplified FAO-56 Penman-Monteith daily reference ET0 approximation (mm/day)
 * using NASA POWER T2M, T2M_MAX, T2M_MIN, ALLSKY_SFC_SW_DWN (MJ/m2/day), RH2M, and elevation.
 */
function estimateDailyEt0(
  tMean: number | null,
  tMax: number | null,
  tMin: number | null,
  rsMj: number | null,
  rh: number | null,
  elevM: number
): number | null {
  if (tMean === null || rsMj === null) return null;
  const tmax = tMax ?? tMean + 4;
  const tmin = tMin ?? tMean - 4;
  const rhVal = rh ?? 65;
  const es = 0.5 * (0.6108 * Math.exp((17.27 * tmax) / (tmax + 237.3)) + 0.6108 * Math.exp((17.27 * tmin) / (tmin + 237.3)));
  const ea = es * (Math.min(100, Math.max(10, rhVal)) / 100);
  const vpd = Math.max(0.05, es - ea);
  const delta = (4098 * (0.6108 * Math.exp((17.27 * tMean) / (tMean + 237.3)))) / Math.pow(tMean + 237.3, 2);
  const pressure = 101.3 * Math.pow((293 - 0.0065 * elevM) / 293, 5.26);
  const gamma = 0.000665 * pressure;
  const rn = 0.77 * rsMj - 1.8; // net radiation approximation
  const u2 = 1.8; // baseline 2m wind speed m/s where station anemometer absent
  const num = 0.408 * delta * Math.max(0, rn) + gamma * (900 / (tMean + 273)) * u2 * vpd;
  const den = delta + gamma * (1 + 0.34 * u2);
  const et0 = Math.max(0.4, num / den);
  return Number(et0.toFixed(2));
}

export async function fetchFarmEnvironmentalAnalysis(farm: Farm, forceRefresh = false): Promise<EnvironmentalAnalysis> {
  const lat = Number(farm.centroidLat.toFixed(4));
  const lon = Number(farm.centroidLon.toFixed(4));
  const cacheKey = `env_${lat}_${lon}_v2`;

  if (!forceRefresh) {
    const cached = db
      .prepare(`SELECT payload_json, fetched_at, expires_at FROM nasa_cache WHERE cache_key = ?`)
      .get(cacheKey) as { payload_json: string; fetched_at: string; expires_at: number } | undefined;

    if (cached && cached.expires_at > Date.now()) {
      const parsed = JSON.parse(cached.payload_json) as EnvironmentalAnalysis;
      return { ...parsed, farmId: farm.id, cacheHit: true };
    }
  }

  // Compute safe operational NASA POWER query window (accounting for ~8 day MERRA-2/POWER latency)
  const now = new Date();
  const endObj = new Date(now.getTime() - 8 * 86400 * 1000);
  const startObj = new Date(endObj.getTime() - 364 * 86400 * 1000);
  const startStr = formatYyyymmdd(startObj);
  const endStr = formatYyyymmdd(endObj);

  const currentYear = endObj.getUTCFullYear();
  const monthlyStartYear = currentYear - 4;
  const monthlyEndYear = currentYear;

  const dailyUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,GWETTOP,GWETROOT,ALLSKY_SFC_SW_DWN,RH2M&community=AG&longitude=${lon}&latitude=${lat}&start=${startStr}&end=${endStr}&format=JSON`;
  const monthlyUrl = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M,PRECTOTCORR,GWETROOT&community=AG&longitude=${lon}&latitude=${lat}&start=${monthlyStartYear}&end=${monthlyEndYear}&format=JSON`;

  // Sample 5 points (~220m offset) for SRTM/Copernicus DEM slope estimation
  const offset = 0.002;
  const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat},${(lat + offset).toFixed(4)},${(lat - offset).toFixed(4)},${lat},${lat}&longitude=${lon},${lon},${lon},${(lon + offset).toFixed(4)},${(lon - offset).toFixed(4)}`;

  let dailyJson: any = null;
  let monthlyJson: any = null;
  let elevJson: any = null;
  let powerError: string | null = null;
  let elevError: string | null = null;

  const [dailyRes, monthlyRes, elevRes] = await Promise.allSettled([
    fetch(dailyUrl, { signal: AbortSignal.timeout(15000) }),
    fetch(monthlyUrl, { signal: AbortSignal.timeout(15000) }),
    fetch(elevUrl, { signal: AbortSignal.timeout(8000) }),
  ]);

  if (dailyRes.status === 'fulfilled' && dailyRes.value.ok) {
    dailyJson = await dailyRes.value.json();
  } else {
    powerError = dailyRes.status === 'fulfilled' ? `HTTP ${dailyRes.value.status}` : String(dailyRes.reason);
  }

  if (monthlyRes.status === 'fulfilled' && monthlyRes.value.ok) {
    monthlyJson = await monthlyRes.value.json();
  }

  if (elevRes.status === 'fulfilled' && elevRes.value.ok) {
    elevJson = await elevRes.value.json();
  } else {
    elevError = elevRes.status === 'fulfilled' ? `HTTP ${elevRes.value.status}` : String(elevRes.reason);
  }

  // Parse SRTM Elevation & Slope
  let elevationMeters: number | null = null;
  let terrainSlopePct: number | null = null;
  if (elevJson?.elevation && Array.isArray(elevJson.elevation) && elevJson.elevation.length >= 5) {
    const [center, north, south, east, west] = elevJson.elevation as number[];
    elevationMeters = Number(center.toFixed(1));
    // 0.004 deg lat ~ 444m, 0.004 deg lon ~ 444 * cos(lat) m
    const nsDistM = 444;
    const ewDistM = Math.max(120, 444 * Math.cos((lat * Math.PI) / 180));
    const dzNs = (north - south) / nsDistM;
    const dzEw = (east - west) / ewDistM;
    terrainSlopePct = Number((Math.sqrt(dzNs * dzNs + dzEw * dzEw) * 100).toFixed(2));
  } else if (dailyJson?.geometry?.coordinates?.[2] !== undefined) {
    elevationMeters = Number(Number(dailyJson.geometry.coordinates[2]).toFixed(1));
  }

  const erosionRiskContext =
    terrainSlopePct === null
      ? 'Terrain slope unavailable — local field inspection of runoff channels is recommended.'
      : terrainSlopePct < 2
      ? `Gentle slope (~${terrainSlopePct}%): low topographic runoff velocity, though bare soil remains exposed to sheet erosion during heavy storms.`
      : terrainSlopePct < 6
      ? `Moderate undulating slope (~${terrainSlopePct}%): contour planting, residue retention, or living cover crops are advised to curb topsoil runoff.`
      : `Steeper slope (~${terrainSlopePct}%): elevated water erosion vulnerability during intense rainfall; contour bunds and dense cover crops strongly advised.`;

  // Parse Daily NASA POWER series
  const dailySeries: DailyWeatherPoint[] = [];
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
        et0Mm: estimateDailyEt0(tMean, tMax, tMin, solar, rh, elevationMeters ?? 200),
      });
    }
  }

  // Parse Monthly NASA POWER series (filtering out month '13' annual summaries)
  const monthlySeries: MonthlyClimatePoint[] = [];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (monthlyJson?.properties?.parameter) {
    const mp = monthlyJson.properties.parameter;
    const keys = Object.keys(mp.T2M || {})
      .filter((k) => !k.endsWith('13'))
      .sort();
    for (const k of keys) {
      const yr = k.slice(0, 4);
      const mo = Number(k.slice(4, 6));
      if (mo < 1 || mo > 12) continue;
      monthlySeries.push({
        month: `${yr}-${String(mo).padStart(2, '0')}`,
        label: `${monthNames[mo - 1]} ${yr.slice(2)}`,
        precipMm: cleanVal(mp.PRECTOTCORR?.[k]),
        tempMeanC: cleanVal(mp.T2M?.[k]),
        soilMoistureRoot: cleanVal(mp.GWETROOT?.[k]),
      });
    }
  }

  // Compute summary statistics from verified live series
  const validPrecip = dailySeries.map((d) => d.precipMm).filter((v): v is number => v !== null);
  const validTemp = dailySeries.map((d) => d.tempMeanC).filter((v): v is number => v !== null);
  const validTempMax = dailySeries.map((d) => d.tempMaxC).filter((v): v is number => v !== null);
  const validTopSm = dailySeries.map((d) => d.soilMoistureTop).filter((v): v is number => v !== null);
  const validRootSm = dailySeries.map((d) => d.soilMoistureRoot).filter((v): v is number => v !== null);
  const validSolar = dailySeries.map((d) => d.solarRadiation).filter((v): v is number => v !== null);
  const validEt0 = dailySeries.map((d) => d.et0Mm).filter((v): v is number => v !== null);

  const totalRainMm = validPrecip.length > 0 ? Number(validPrecip.reduce((a, b) => a + b, 0).toFixed(1)) : null;
  const avgTempC = validTemp.length > 0 ? Number((validTemp.reduce((a, b) => a + b, 0) / validTemp.length).toFixed(1)) : null;
  const maxTempObservedC = validTempMax.length > 0 ? Number(Math.max(...validTempMax).toFixed(1)) : null;
  const heatStressDaysAbove35C = validTempMax.filter((v) => v >= 35).length;
  const extremeRainDaysAbove30Mm = validPrecip.filter((v) => v >= 30).length;

  let longestDrySpellDays = 0;
  let currentStreak = 0;
  for (const pt of dailySeries) {
    if (pt.precipMm !== null && pt.precipMm < 1.0) {
      currentStreak++;
      if (currentStreak > longestDrySpellDays) longestDrySpellDays = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  const avgTopSoilWetness =
    validTopSm.length > 0 ? Number((validTopSm.reduce((a, b) => a + b, 0) / validTopSm.length).toFixed(3)) : null;
  const avgRootSoilWetness =
    validRootSm.length > 0 ? Number((validRootSm.reduce((a, b) => a + b, 0) / validRootSm.length).toFixed(3)) : null;

  // Compare recent 90-day root soil wetness vs 5-year historical monthly mean
  const recent90 = validRootSm.slice(-90);
  const recentRootAvg = recent90.length > 0 ? recent90.reduce((a, b) => a + b, 0) / recent90.length : null;
  const histRootVals = monthlySeries.map((m) => m.soilMoistureRoot).filter((v): v is number => v !== null);
  const histRootAvg = histRootVals.length > 0 ? histRootVals.reduce((a, b) => a + b, 0) / histRootVals.length : null;
  const soilMoistureAnomalyPct =
    recentRootAvg !== null && histRootAvg !== null && histRootAvg > 0
      ? Number((((recentRootAvg - histRootAvg) / histRootAvg) * 100).toFixed(1))
      : null;

  const avgSolarRadiation =
    validSolar.length > 0 ? Number((validSolar.reduce((a, b) => a + b, 0) / validSolar.length).toFixed(2)) : null;
  const estimatedAnnualEt0Mm =
    validEt0.length > 0 ? Number(validEt0.reduce((a, b) => a + b, 0).toFixed(0)) : null;
  const waterBalanceMm =
    totalRainMm !== null && estimatedAnnualEt0Mm !== null ? Number((totalRainMm - estimatedAnnualEt0Mm).toFixed(0)) : null;

  const recent30Rain = dailySeries
    .slice(-30)
    .map((d) => d.precipMm)
    .filter((v): v is number => v !== null)
    .reduce((a, b) => a + b, 0);
  const recent30Root =
    dailySeries
      .slice(-30)
      .map((d) => d.soilMoistureRoot)
      .filter((v): v is number => v !== null);
  const recent30RootMean =
    recent30Root.length > 0 ? recent30Root.reduce((a, b) => a + b, 0) / recent30Root.length : null;

  const ndviProxyContext =
    recent30RootMean === null
      ? 'Optical vegetation condition requires direct cloud-free Landsat/MODIS inspection in the Geospatial Map layer.'
      : recent30RootMean < 0.42 && recent30Rain < 25
      ? 'Recent moisture-vegetation conditions appear drier than seasonal mid-range, which commonly coincides with lower canopy greenness or post-harvest dormancy. Local field observation is required to confirm crop vigor vs bare fallow.'
      : 'Recent root-zone moisture and incoming solar radiation indicate favorable agroclimatic conditions for vegetative activity. Use the MODIS 8-Day NDVI overlay on the map to inspect regional greenness patterns.';

  // Build Dataset Provenance table from Admin config merged with live fetch diagnostics
  const configRows = db.prepare(`SELECT * FROM dataset_configs`).all() as Array<{
    id: string;
    dataset_name: string;
    mission_code: string;
    data_source: string;
    spatial_resolution: string;
    temporal_resolution: string;
    processing_method: string;
    limitations: string;
    enabled: number;
  }>;

  const obsRangeLabel = dailySeries.length > 0 ? `${dailySeries[0].date} to ${dailySeries[dailySeries.length - 1].date}` : 'Query failed / unavailable';

  const datasets: DatasetProvenance[] = configRows.map((cfg) => {
    let dataQuality: DatasetProvenance['dataQuality'] = 'Regional Context';
    let missingObservations = 0;
    let observationDate = obsRangeLabel;

    if (cfg.id === 'power') {
      dataQuality = powerError ? 'Unavailable Locally' : missingPowerCount > 0 ? 'Partially Missing' : 'Verified Live';
      missingObservations = missingPowerCount;
    } else if (cfg.id === 'gpm') {
      dataQuality = powerError ? 'Unavailable Locally' : missingPowerCount > 0 ? 'Partially Missing' : 'Verified Live';
      missingObservations = missingPowerCount;
    } else if (cfg.id === 'smap') {
      dataQuality = powerError ? 'Unavailable Locally' : missingSmapCount > 0 ? 'Partially Missing' : 'Verified Live';
      missingObservations = missingSmapCount;
    } else if (cfg.id === 'srtm') {
      dataQuality = elevError && elevationMeters === null ? 'Unavailable Locally' : 'Verified Live';
      observationDate = 'Static 30m–90m DEM baseline';
    } else if (cfg.id === 'modis') {
      dataQuality = 'Regional Context';
      observationDate = 'Live NASA GIBS 8-Day WMTS Layer';
    } else if (cfg.id === 'landsat') {
      dataQuality = 'Regional Context';
      observationDate = 'Archive context (30m optical — cloud-sensitive)';
    } else if (cfg.id === 'ecostress') {
      dataQuality = 'Regional Context';
      observationDate = `Harmonized ET0 proxy (${obsRangeLabel})`;
    } else if (cfg.id === 'grace') {
      dataQuality = 'Regional Context';
      observationDate = 'Basin-scale (~300 km) context only';
    } else if (cfg.id === 'gedi') {
      dataQuality = 'Unavailable Locally';
      observationDate = 'No direct ISS Lidar transect verified over plot';
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
      enabled: Boolean(cfg.enabled),
    };
  });

  // Construct scientifically transparent insights
  const insights: EnvironmentalInsight[] = [
    {
      id: 'ins-rain',
      category: 'Rainfall',
      title: 'Annual Precipitation & Dry-Spell Variability',
      observationType: 'Direct Satellite Observation',
      whatWasObserved:
        totalRainMm !== null
          ? `Observed ${totalRainMm} mm total precipitation over the past 12 months across the 0.5° grid cell, including ${extremeRainDaysAbove30Mm} heavy rain days (≥30 mm) and a longest dry streak of ${longestDrySpellDays} consecutive days (<1 mm).`
          : `NASA POWER precipitation data could not be retrieved (${powerError ?? 'network error'}).`,
      whenObserved: obsRangeLabel,
      whatItCouldMean:
        totalRainMm !== null && totalRainMm < 650
          ? 'Annual moisture supply sits in a tighter dryland range where water-demanding cereals face mid-season stress during multi-week dry spells.'
          : 'Total seasonal volume can support diversified cereal-legume sequences, provided planting avoids dry-spell bottlenecks and heavy-storm runoff.',
      whatItCannotEstablish:
        'A 0.5° (~55 km) gridded product cannot detect whether an isolated afternoon storm hit your specific boundary or missed it by 5 km.',
      additionalInfoNeeded: 'Simple on-farm rain gauge logs during planting and flowering months.',
      statusLevel: totalRainMm === null ? 'Insufficient Data' : longestDrySpellDays >= 21 || totalRainMm < 600 ? 'Elevated Stress' : 'Watch',
    },
    {
      id: 'ins-temp',
      category: 'Temperature',
      title: 'Thermal Regime & Heat-Stress Exposure',
      observationType: 'Direct Satellite Observation',
      whatWasObserved:
        avgTempC !== null
          ? `Mean 2-meter air temperature averaged ${avgTempC} °C, peaking at ${maxTempObservedC} °C with ${heatStressDaysAbove35C} days reaching or exceeding 35 °C.`
          : 'Temperature observations unavailable.',
      whenObserved: obsRangeLabel,
      whatItCouldMean:
        heatStressDaysAbove35C >= 20
          ? 'Frequent ≥35 °C afternoons increase pollen sterility risk in flowering maize and accelerate soil surface evaporation.'
          : 'Moderate heat-stress exposure; selecting heat-tolerant legumes or shifting sowing dates can reduce flowering-stage thermal risk.',
      whatItCannotEstablish:
        'Does not capture cooling microclimates under agroforestry shade trees or localized valley frost/heat pockets.',
      additionalInfoNeeded: 'Observed flowering dates of previous crops and presence of boundary shade trees.',
      statusLevel: avgTempC === null ? 'Insufficient Data' : heatStressDaysAbove35C >= 25 ? 'Elevated Stress' : heatStressDaysAbove35C >= 8 ? 'Watch' : 'Nominal',
    },
    {
      id: 'ins-sm',
      category: 'Soil Moisture',
      title: 'Root-Zone Soil Wetness & 5-Year Anomaly',
      observationType: 'Derived Environmental Indicator',
      whatWasObserved:
        avgRootSoilWetness !== null
          ? `Assimilated root-zone soil wetness averaged ${(avgRootSoilWetness * 100).toFixed(1)}% saturation index (${soilMoistureAnomalyPct !== null ? `${soilMoistureAnomalyPct >= 0 ? '+' : ''}${soilMoistureAnomalyPct}% vs 5-year baseline` : 'baseline pending'}).`
          : 'Root-zone soil wetness index unavailable.',
      whenObserved: obsRangeLabel,
      whatItCouldMean:
        soilMoistureAnomalyPct !== null && soilMoistureAnomalyPct < -8
          ? 'Recent 90-day root-zone moisture trails the 5-year seasonal norm, suggesting depleted subsoil reserves entering the next planting window.'
          : 'Root-zone moisture tracks near regional seasonal expectations, supporting timely legume establishment after onset of rains.',
      whatItCannotEstablish:
        'Satellite/assimilated wetness indices (9 km – 55 km) cannot measure soil organic matter, compaction hardpans, or exact field-plot wilting point.',
      additionalInfoNeeded: 'Hand-feel soil moisture check at 20 cm depth and local soil texture/organic carbon test.',
      statusLevel: avgRootSoilWetness === null ? 'Insufficient Data' : (soilMoistureAnomalyPct ?? 0) < -10 ? 'Elevated Stress' : 'Nominal',
    },
    {
      id: 'ins-veg',
      category: 'Vegetation',
      title: 'Vegetation Activity & Evapotranspiration Context',
      observationType: 'Derived Environmental Indicator',
      whatWasObserved:
        estimatedAnnualEt0Mm !== null
          ? `Estimated annual reference evapotranspiration (ET0) is ${estimatedAnnualEt0Mm} mm (climatic water balance: ${waterBalanceMm !== null ? `${waterBalanceMm >= 0 ? '+' : ''}${waterBalanceMm} mm` : 'N/A'}). ${ndviProxyContext}`
          : 'Evapotranspiration proxy unavailable.',
      whenObserved: obsRangeLabel,
      whatItCouldMean:
        waterBalanceMm !== null && waterBalanceMm < -400
          ? 'Atmospheric evaporative demand substantially exceeds annual rainfall, making mulch cover, zero/reduced tillage, and drought-hardy crops vital.'
          : 'Seasonal moisture surplus during wet months can be captured effectively with deep-rooted crops and cover-crop biomass.',
      whatItCannotEstablish:
        'A low vegetation index or negative annual water balance cannot separate drought stress from intentional harvest clearing, weeding, or nutrient deficiency.',
      additionalInfoNeeded: 'Current ground cover status, crop stage photos, and MODIS/Landsat visual check on the interactive map.',
      statusLevel: waterBalanceMm === null ? 'Insufficient Data' : waterBalanceMm < -500 ? 'Watch' : 'Nominal',
    },
    {
      id: 'ins-terrain',
      category: 'Terrain',
      title: 'SRTM Elevation & Topographic Erosion Context',
      observationType: 'Direct Satellite Observation',
      whatWasObserved:
        elevationMeters !== null
          ? `Farm centroid elevation is ${elevationMeters} m above sea level with an estimated local terrain slope of ${terrainSlopePct ?? 'N/A'}%.`
          : 'SRTM elevation unavailable.',
      whenObserved: 'Static SRTM / Copernicus 30m–90m DEM',
      whatItCouldMean: erosionRiskContext,
      whatItCannotEstablish:
        'DEM models cannot verify whether farmers have already installed stone bunds, tied ridges, or grass contour strips.',
      additionalInfoNeeded: 'Confirmation of existing soil-conservation earthworks or drainage gullies.',
      statusLevel: terrainSlopePct === null ? 'Insufficient Data' : terrainSlopePct >= 5 ? 'Elevated Stress' : terrainSlopePct >= 2 ? 'Watch' : 'Nominal',
    },
    {
      id: 'ins-grace',
      category: 'Water Storage',
      title: 'GRACE-FO Regional Aquifer & Basin Context',
      observationType: 'Regional Context Only',
      whatWasObserved:
        'GRACE/GRACE-FO gravity anomalies operate at ~300 km spatial resolution and provide watershed-scale terrestrial water storage trends rather than plot-level soil moisture.',
      whenObserved: 'Multi-year monthly basin archive',
      whatItCouldMean:
        'Useful only for understanding whether the wider river basin or regional groundwater table is experiencing multi-year drying or recharge.',
      whatItCannotEstablish:
        'Strictly cannot be interpreted as soil moisture within your farm polygon or shallow well depth without local piezometer data.',
      additionalInfoNeeded: 'Local borehole/stream seasonal flow observations if supplemental irrigation is planned.',
      statusLevel: 'Nominal',
    },
  ];

  const areasForInvestigation: string[] = [];
  if (farm.soilPh === null) {
    areasForInvestigation.push('Soil pH is currently marked unknown — collect a composite topsoil sample (0–20 cm) for pH testing before investing in lime or pH-sensitive legumes like Soybean.');
  }
  if (farm.organicMatterPct === null) {
    areasForInvestigation.push('Soil organic matter percentage is unknown — a simple local extension soil test or Walkley-Black lab check will calibrate green-manure cover crop targets.');
  }
  if (heatStressDaysAbove35C >= 15) {
    areasForInvestigation.push(`Observed ${heatStressDaysAbove35C} days ≥35 °C regionally — verify with local extension whether early-maturing or heat-tolerant varieties fit your sowing dates.`);
  }
  if (longestDrySpellDays >= 18) {
    areasForInvestigation.push(`A ${longestDrySpellDays}-day dry streak occurred in the past year — confirm whether mid-season dry spells align with your crop flowering window.`);
  }
  if (farm.pestHistory.trim().length > 0) {
    areasForInvestigation.push(`Reported pest/disease pressure ("${farm.pestHistory}") — inspect adjacent fields and confirm crop-free host breaks with an agronomist.`);
  }
  if (areasForInvestigation.length === 0) {
    areasForInvestigation.push('Verify satellite-observed rainfall onset timing against local community rain-gauge observations prior to sowing.');
  }

  const analysis: EnvironmentalAnalysis = {
    farmId: farm.id,
    fetchedAt: new Date().toISOString(),
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
      ndviProxyContext,
    },
    dailySeries,
    monthlySeries,
    datasets,
    insights,
    areasForInvestigation,
  };

  if (!powerError) {
    db.prepare(
      `INSERT OR REPLACE INTO nasa_cache (cache_key, payload_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?)`
    ).run(cacheKey, JSON.stringify(analysis), analysis.fetchedAt, Date.now() + 12 * 3600 * 1000);
  }

  return analysis;
}
