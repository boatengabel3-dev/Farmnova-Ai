import { generateRotationStrategies, simulateClimateScenarios } from '../../server/rotationEngine';
import { STATIC_DATASETS } from './staticSeed';
import type {
  ClimateScenarioParams,
  ClimateScenarioResult,
  Crop,
  DailyWeatherPoint,
  DatasetProvenance,
  EnvironmentalAnalysis,
  EnvironmentalInsight,
  Farm,
  FarmHazard,
  ForecastDay,
  MonthlyClimatePoint,
  RealtimeWeatherForecast,
  RotationStrategy,
} from '../types';

function formatYyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function formatIsoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

import { readFarmPowerCache, writeFarmPowerCache } from './supabaseCache';

function cleanVal(v: unknown, fillValue = -999): number | null {
  if (v === undefined || v === null || typeof v !== 'number' || Number.isNaN(v)) return null;
  if (v <= -900 || v === fillValue) return null;
  return Number(v.toFixed(3));
}

function estimateDailyEt0(
  tMean: number | null,
  tMax: number | null,
  tMin: number | null,
  rsMj: number | null,
  rh: number | null,
  elevM: number | null
): number | null {
  if (tMean === null || tMax === null || tMin === null || rsMj === null || rh === null) {
    return null;
  }
  const elev = elevM ?? 200;
  const es =
    0.5 *
    (0.6108 * Math.exp((17.27 * tMax) / (tMax + 237.3)) +
      0.6108 * Math.exp((17.27 * tMin) / (tMin + 237.3)));
  const ea = es * (Math.min(100, Math.max(10, rh)) / 100);
  const vpd = Math.max(0.05, es - ea);
  const delta =
    (4098 * (0.6108 * Math.exp((17.27 * tMean) / (tMean + 237.3)))) / Math.pow(tMean + 237.3, 2);
  const pressure = 101.3 * Math.pow((293 - 0.0065 * elev) / 293, 5.26);
  const gamma = 0.000665 * pressure;
  const rn = 0.77 * rsMj - 1.8;
  const u2 = 1.8;
  const num = 0.408 * delta * Math.max(0, rn) + gamma * (900 / (tMean + 273)) * u2 * vpd;
  const den = delta + gamma * (1 + 0.34 * u2);
  return Number(Math.max(0.2, num / den).toFixed(2));
}

function decodeWmoWeather(code: number | null): { label: string; summary: string } {
  if (code === null || Number.isNaN(code)) {
    return { label: 'Unavailable', summary: 'Live sky condition unavailable.' };
  }
  if (code === 0) return { label: 'Clear Sky', summary: 'Clear sunshine with high evaporation.' };
  if (code === 1) return { label: 'Mostly Clear', summary: 'Mostly sunny with light scattered clouds.' };
  if (code === 2) return { label: 'Partly Cloudy', summary: 'Mix of sun and clouds.' };
  if (code === 3) return { label: 'Overcast', summary: 'Full cloud cover reducing midday leaf heat.' };
  if (code === 45 || code === 48) return { label: 'Fog / Mist', summary: 'High surface moisture and morning mist.' };
  if (code >= 51 && code <= 57) return { label: 'Drizzle', summary: 'Light drizzle; foliage may stay damp.' };
  if (code >= 61 && code <= 63) return { label: 'Moderate Rain', summary: 'Steady rainfall beneficial for soil recharge.' };
  if (code >= 65 && code <= 67) return { label: 'Heavy Rain', summary: 'Intense rain; watch for runoff or waterlogging.' };
  if (code >= 71 && code <= 77) return { label: 'Snow / Sleet', summary: 'Freezing precipitation; protect tender crops.' };
  if (code >= 80 && code <= 82) return { label: 'Rain Showers', summary: 'Passing showers; check drainage before spraying.' };
  if (code >= 85 && code <= 86) return { label: 'Snow Showers', summary: 'Wintry showers and cold soil surface.' };
  if (code >= 95) return { label: 'Thunderstorm', summary: 'Storm cells with gusty winds and heavy downpours.' };
  return { label: 'Variable', summary: 'Changing local sky conditions.' };
}

function formatDayLabel(isoDate: string, idx: number): string {
  if (idx === 0) return 'Today';
  if (idx === 1) return 'Tomorrow';
  const dt = new Date(`${isoDate}T12:00:00Z`);
  return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export async function fetchStaticRealtimeForecast(lat: number, lon: number): Promise<RealtimeWeatherForecast> {
  const rLat = Number(lat.toFixed(4));
  const rLon = Number(lon.toFixed(4));
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${rLat}&longitude=${rLon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,et0_fao_evapotranspiration,uv_index_max` +
    `&forecast_days=7&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Real-time weather service returned HTTP ${res.status}`);
  const json = await res.json();
  const cur = json.current ?? {};
  const dailyRaw = json.daily ?? {};
  const dates: string[] = Array.isArray(dailyRaw.time) ? dailyRaw.time : [];

  const curCode = typeof cur.weather_code === 'number' ? cur.weather_code : null;
  const curDecoded = decodeWmoWeather(curCode);

  const daily: ForecastDay[] = dates.map((d, idx) => {
    const code = typeof dailyRaw.weather_code?.[idx] === 'number' ? dailyRaw.weather_code[idx] : null;
    const dec = decodeWmoWeather(code);
    return {
      date: d,
      dayLabel: formatDayLabel(d, idx),
      weatherCode: code,
      conditionLabel: dec.label,
      tempMaxC: typeof dailyRaw.temperature_2m_max?.[idx] === 'number' ? Number(dailyRaw.temperature_2m_max[idx].toFixed(1)) : null,
      tempMinC: typeof dailyRaw.temperature_2m_min?.[idx] === 'number' ? Number(dailyRaw.temperature_2m_min[idx].toFixed(1)) : null,
      precipSumMm: typeof dailyRaw.precipitation_sum?.[idx] === 'number' ? Number(dailyRaw.precipitation_sum[idx].toFixed(1)) : null,
      precipProbPct: typeof dailyRaw.precipitation_probability_max?.[idx] === 'number' ? Math.round(dailyRaw.precipitation_probability_max[idx]) : null,
      windMaxKmh: typeof dailyRaw.wind_speed_10m_max?.[idx] === 'number' ? Math.round(dailyRaw.wind_speed_10m_max[idx]) : null,
      windGustMaxKmh: typeof dailyRaw.wind_gusts_10m_max?.[idx] === 'number' ? Math.round(dailyRaw.wind_gusts_10m_max[idx]) : null,
      et0Mm: typeof dailyRaw.et0_fao_evapotranspiration?.[idx] === 'number' ? Number(dailyRaw.et0_fao_evapotranspiration[idx].toFixed(1)) : null,
      uvIndexMax: typeof dailyRaw.uv_index_max?.[idx] === 'number' ? Number(dailyRaw.uv_index_max[idx].toFixed(1)) : null,
    };
  });

  const weeklyRainTotalMm = Number(daily.reduce((sum, d) => sum + (d.precipSumMm ?? 0), 0).toFixed(1));
  const maxTemps = daily.map((d) => d.tempMaxC).filter((v): v is number => v !== null);
  const minTemps = daily.map((d) => d.tempMinC).filter((v): v is number => v !== null);

  return {
    source: 'Open-Meteo Real-Time Atmospheric Forecast',
    fetchedAt: new Date().toISOString(),
    current: {
      observedAt: cur.time || new Date().toISOString(),
      timezone: json.timezone || 'UTC',
      temperatureC: typeof cur.temperature_2m === 'number' ? Number(cur.temperature_2m.toFixed(1)) : null,
      feelsLikeC: typeof cur.apparent_temperature === 'number' ? Number(cur.apparent_temperature.toFixed(1)) : null,
      humidityPct: typeof cur.relative_humidity_2m === 'number' ? Math.round(cur.relative_humidity_2m) : null,
      precipMm: typeof cur.precipitation === 'number' ? Number(cur.precipitation.toFixed(1)) : null,
      windKmh: typeof cur.wind_speed_10m === 'number' ? Math.round(cur.wind_speed_10m) : null,
      windGustKmh: typeof cur.wind_gusts_10m === 'number' ? Math.round(cur.wind_gusts_10m) : null,
      weatherCode: curCode,
      conditionLabel: curDecoded.label,
      conditionSummary: curDecoded.summary,
    },
    daily,
    weeklyRainTotalMm,
    maxForecastTempC: maxTemps.length > 0 ? Math.max(...maxTemps) : null,
    minForecastTempC: minTemps.length > 0 ? Math.min(...minTemps) : null,
  };
}

export function evaluateStaticHazards(
  farm: Farm,
  analysis: EnvironmentalAnalysis,
  forecast: RealtimeWeatherForecast | null
): FarmHazard[] {
  const hazards: FarmHazard[] = [];
  const days = forecast?.daily ?? [];
  const peakRainDay = days.reduce<ForecastDay | null>(
    (best, d) => (!best || (d.precipSumMm ?? 0) > (best.precipSumMm ?? 0) ? d : best),
    null
  );
  const maxDailyRain = peakRainDay?.precipSumMm ?? 0;
  const slope = analysis.terrainSlopePct ?? 0;

  if (maxDailyRain >= 35 || (days.filter((d) => (d.precipSumMm ?? 0) >= 25).length >= 2 && slope >= 3)) {
    hazards.push({
      id: 'haz-flood',
      type: 'Flood / Heavy Rain',
      title: 'Heavy Rain & Field Washout Risk',
      severity: maxDailyRain >= 50 || slope >= 6 ? 'Severe' : 'High',
      timingWindow: peakRainDay ? `${peakRainDay.dayLabel} (${peakRainDay.date})` : 'Next 7 days',
      plainSummary: `Strong rain up to ${maxDailyRain} mm in a single day could waterlog low areas or wash away topsoil.`,
      triggerDetail: `7-day live forecast peak ${maxDailyRain} mm/day · Terrain slope ${analysis.terrainSlopePct ?? 'unknown'}%`,
      farmerActions: [
        'Clear field drainage ditches and bunds before heavy rain arrives.',
        'Delay top-dressing fertilizer or herbicide spraying until heavy showers pass.',
      ],
    });
  } else if (maxDailyRain >= 18) {
    hazards.push({
      id: 'haz-rain-mod',
      type: 'Flood / Heavy Rain',
      title: 'Moderate Storm Showers Expected',
      severity: 'Moderate',
      timingWindow: peakRainDay ? `${peakRainDay.dayLabel} (${peakRainDay.date})` : 'Next 7 days',
      plainSummary: `Rain showers up to ${maxDailyRain} mm/day are expected.`,
      triggerDetail: `Forecast daily peak ${maxDailyRain} mm`,
      farmerActions: ['Apply foliar sprays or fertilizers on dry mornings at least 6 hours before rain.'],
    });
  }

  const hotForecastDays = days.filter((d) => (d.tempMaxC ?? 0) >= 35);
  const peakTemp = forecast?.maxForecastTempC ?? analysis.periodSummary.maxTempObservedC ?? 0;
  if (hotForecastDays.length >= 2 || peakTemp >= 37 || analysis.periodSummary.heatStressDaysAbove35C >= 20) {
    hazards.push({
      id: 'haz-heat',
      type: 'Heatwave',
      title: 'High Heat & Crop Wilting Stress',
      severity: peakTemp >= 39 || hotForecastDays.length >= 4 ? 'High' : 'Moderate',
      timingWindow: hotForecastDays.length > 0 ? `${hotForecastDays.length} days in next 7 days` : 'Seasonal NASA pattern',
      plainSummary: `Daytime temperatures reaching ${peakTemp}°C can stress young seedlings and reduce grain-filling.`,
      triggerDetail: `Forecast peak ${peakTemp}°C · ${analysis.periodSummary.heatStressDaysAbove35C} past-year days >=35°C`,
      farmerActions: [
        'Keep crop residue mulch on bare soil to cool the root zone.',
        'Schedule watering or transplanting early in the morning.',
      ],
    });
  }

  const weekRain = forecast?.weeklyRainTotalMm ?? 0;
  const rootWetPct =
    analysis.periodSummary.avgRootSoilWetness !== null ? analysis.periodSummary.avgRootSoilWetness * 100 : null;
  if (weekRain < 4 && ((rootWetPct !== null && rootWetPct < 45) || analysis.periodSummary.longestDrySpellDays >= 16)) {
    hazards.push({
      id: 'haz-dry',
      type: 'Dry Spell / Drought',
      title: 'Dry Week & Low Soil Moisture',
      severity: weekRain < 1 && rootWetPct !== null && rootWetPct < 38 ? 'High' : 'Moderate',
      timingWindow: 'Next 7 days',
      plainSummary: `Very little rain (${weekRain} mm total) is forecast this week while deeper soil moisture is low.`,
      triggerDetail: `7-day forecast rain: ${weekRain} mm · NASA root-zone wetness: ${rootWetPct !== null ? `${rootWetPct.toFixed(1)}%` : 'N/A'}`,
      farmerActions: [
        'Hold off dry sowing until soil is moist at 5–10 cm depth.',
        'Weed early so weeds do not steal scarce moisture from crops.',
      ],
    });
  }

  if (hazards.length === 0) {
    hazards.push({
      id: 'haz-nominal',
      type: 'Dry Spell / Drought',
      title: 'No Acute Weather Hazards Detected',
      severity: 'Low',
      timingWindow: 'Next 7 days',
      plainSummary: `Current 7-day live weather for ${farm.name} stays within manageable temperature, wind, and rainfall bounds.`,
      triggerDetail: `7-day rain ${weekRain} mm · Peak ${forecast?.maxForecastTempC ?? 'N/A'}°C`,
      farmerActions: ['Good window for routine weeding, scouting, and scheduled field work.'],
    });
  }

  return hazards;
}

export async function fetchStaticEnvironmentalAnalysis(farm: Farm): Promise<{
  analysis: EnvironmentalAnalysis;
  strategies: RotationStrategy[];
}> {
  const cached = await readFarmPowerCache(farm);
  if (cached) {
    return { analysis: cached, strategies: [] };
  }

  const lat = Number(farm.centroidLat.toFixed(4));
  const lon = Number(farm.centroidLon.toFixed(4));
  const now = new Date();
  const endObj = new Date(now.getTime() - 1 * 86400 * 1000);
  const startObj = new Date(endObj.getTime() - 179 * 86400 * 1000);
  const startStr = formatYyyymmdd(startObj);
  const endStr = formatYyyymmdd(endObj);
  const currentYear = endObj.getUTCFullYear();
  const monthlyStartYear = Math.max(1981, currentYear - 10);

  const dailyUrl = `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,GWETROOT,GWETTOP,ALLSKY_SFC_SW_DWN,RH2M&community=AG&longitude=${lon}&latitude=${lat}&start=${startStr}&end=${endStr}&format=JSON`;
  const monthlyUrl = `https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=PRECTOTCORR,T2M,T2M_MAX,GWETROOT&community=AG&longitude=${lon}&latitude=${lat}&start=${monthlyStartYear}&end=${currentYear}&format=JSON`;
  const offset = 0.002;
  const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat},${(lat + offset).toFixed(4)},${(lat - offset).toFixed(4)},${lat},${lat}&longitude=${lon},${lon},${lon},${(lon + offset).toFixed(4)},${(lon - offset).toFixed(4)}`;

  const [dailyRes, monthlyRes, elevRes, forecast] = await Promise.all([
    fetch(dailyUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(monthlyUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(elevUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetchStaticRealtimeForecast(lat, lon).catch(() => null),
  ]);

  let elevationMeters: number | null = null;
  let terrainSlopePct: number | null = null;
  if (elevRes && Array.isArray(elevRes.elevation) && elevRes.elevation.length >= 5) {
    const [center, n, s, e, w] = elevRes.elevation.map(Number);
    if (!Number.isNaN(center)) {
      elevationMeters = Math.round(center);
      const nsGrad = Math.abs(n - s) / 444;
      const ewGrad = Math.abs(e - w) / (444 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
      terrainSlopePct = Number((Math.sqrt(nsGrad * nsGrad + ewGrad * ewGrad) * 100).toFixed(2));
    }
  }

  const rawDailySeries: DailyWeatherPoint[] = [];
  const pDaily = dailyRes?.properties?.parameter ?? null;
  const fillVal = typeof dailyRes?.header?.fill_value === 'number' ? dailyRes.header.fill_value : -999;
  let missingPowerObs = 0;

  if (pDaily && typeof pDaily === 'object') {
    const keys = Array.from(
      new Set<string>([
        ...Object.keys(pDaily.PRECTOTCORR || {}),
        ...Object.keys(pDaily.T2M || {}),
        ...Object.keys(pDaily.T2M_MAX || {}),
        ...Object.keys(pDaily.GWETROOT || {}),
      ])
    )
      .filter((k) => /^\d{8}$/.test(k))
      .sort();

    for (const k of keys) {
      const tMean = cleanVal(pDaily.T2M?.[k], fillVal);
      const tMax = cleanVal(pDaily.T2M_MAX?.[k], fillVal);
      const tMin = cleanVal(pDaily.T2M_MIN?.[k], fillVal);
      const precip = cleanVal(pDaily.PRECTOTCORR?.[k], fillVal);
      const smTop = cleanVal(pDaily.GWETTOP?.[k], fillVal);
      const smRoot = cleanVal(pDaily.GWETROOT?.[k], fillVal);
      const solar = cleanVal(pDaily.ALLSKY_SFC_SW_DWN?.[k], fillVal);
      const rh = cleanVal(pDaily.RH2M?.[k], fillVal);
      rawDailySeries.push({
        date: formatIsoDate(k),
        tempMeanC: tMean,
        tempMaxC: tMax,
        tempMinC: tMin,
        precipMm: precip,
        soilMoistureTop: smTop,
        soilMoistureRoot: smRoot,
        solarRadiation: solar,
        humidityPct: rh,
        et0Mm: estimateDailyEt0(tMean, tMax, tMin, solar, rh, elevationMeters),
      });
    }
  }

  let lastValidIdx = rawDailySeries.length - 1;
  while (
    lastValidIdx >= 0 &&
    rawDailySeries[lastValidIdx].precipMm === null &&
    rawDailySeries[lastValidIdx].tempMeanC === null &&
    rawDailySeries[lastValidIdx].tempMaxC === null &&
    rawDailySeries[lastValidIdx].soilMoistureRoot === null
  ) {
    lastValidIdx--;
  }
  const dailySeries = lastValidIdx >= 0 ? rawDailySeries.slice(0, lastValidIdx + 1) : rawDailySeries;
  const lastAvailableDate = dailySeries.length > 0 ? dailySeries[dailySeries.length - 1].date : null;
  for (const d of dailySeries) {
    if (d.tempMeanC === null || d.precipMm === null) missingPowerObs += 1;
  }

  const monthlySeries: MonthlyClimatePoint[] = [];
  const pMonthly = monthlyRes?.properties?.parameter ?? null;
  const mFill = typeof monthlyRes?.header?.fill_value === 'number' ? monthlyRes.header.fill_value : -999;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthDays = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const climoBuckets = Array.from({ length: 12 }, () => ({
    precip: [] as number[],
    temp: [] as number[],
    tmax: [] as number[],
    root: [] as number[],
  }));

  if (pMonthly && typeof pMonthly === 'object') {
    const keys = Object.keys(pMonthly.PRECTOTCORR || pMonthly.T2M || {})
      .filter((k) => /^\d{6}$/.test(k) && !k.endsWith('13'))
      .sort();
    for (const k of keys) {
      const mo = Number(k.slice(4, 6));
      if (mo < 1 || mo > 12) continue;
      const pVal = cleanVal(pMonthly.PRECTOTCORR?.[k], mFill);
      const tVal = cleanVal(pMonthly.T2M?.[k], mFill);
      const txVal = cleanVal(pMonthly.T2M_MAX?.[k], mFill);
      const rVal = cleanVal(pMonthly.GWETROOT?.[k], mFill);
      if (pVal !== null) climoBuckets[mo - 1].precip.push(pVal);
      if (tVal !== null) climoBuckets[mo - 1].temp.push(tVal);
      if (txVal !== null) climoBuckets[mo - 1].tmax.push(txVal);
      if (rVal !== null) climoBuckets[mo - 1].root.push(rVal);
      monthlySeries.push({
        month: `${k.slice(0, 4)}-${String(mo).padStart(2, '0')}`,
        label: `${monthNames[mo - 1]} ${k.slice(2, 4)}`,
        precipMm: pVal,
        tempMeanC: tVal,
        soilMoistureRoot: rVal,
      });
    }
  }

  const climatology10Yr = climoBuckets.map((b, idx) => {
    const avgP = b.precip.length > 0 ? Number((b.precip.reduce((s, v) => s + v, 0) / b.precip.length).toFixed(2)) : null;
    return {
      monthIndex: idx + 1,
      label: monthNames[idx],
      avgPrecipMmPerDay: avgP,
      avgMonthlyRainMm: avgP !== null ? Number((avgP * monthDays[idx]).toFixed(1)) : null,
      avgTempC: b.temp.length > 0 ? Number((b.temp.reduce((s, v) => s + v, 0) / b.temp.length).toFixed(1)) : null,
      avgMaxTempC: b.tmax.length > 0 ? Number((b.tmax.reduce((s, v) => s + v, 0) / b.tmax.length).toFixed(1)) : null,
      avgRootWetness: b.root.length > 0 ? Number((b.root.reduce((s, v) => s + v, 0) / b.root.length).toFixed(3)) : null,
    };
  });

  const validRain = dailySeries.map((d) => d.precipMm).filter((v): v is number => v !== null);
  const validTemp = dailySeries.map((d) => d.tempMeanC).filter((v): v is number => v !== null);
  const validTempMax = dailySeries.map((d) => d.tempMaxC).filter((v): v is number => v !== null);
  const validTopSm = dailySeries.map((d) => d.soilMoistureTop).filter((v): v is number => v !== null);
  const validRootSm = dailySeries.map((d) => d.soilMoistureRoot).filter((v): v is number => v !== null);
  const validSolar = dailySeries.map((d) => d.solarRadiation).filter((v): v is number => v !== null);
  const validEt0 = dailySeries.map((d) => d.et0Mm).filter((v): v is number => v !== null);

  let longestDrySpellDays = 0;
  let curDry = 0;
  for (const d of dailySeries) {
    if (d.precipMm !== null && d.precipMm < 1.0) {
      curDry += 1;
      if (curDry > longestDrySpellDays) longestDrySpellDays = curDry;
    } else if (d.precipMm !== null) {
      curDry = 0;
    }
  }

  const last30Slice = dailySeries.slice(-30);
  const valid30Rain = last30Slice.map((d) => d.precipMm).filter((v): v is number => v !== null);
  const valid30Temp = last30Slice.map((d) => d.tempMeanC).filter((v): v is number => v !== null);
  const last30DaysRainMm = valid30Rain.length > 0 ? Number(valid30Rain.reduce((a, b) => a + b, 0).toFixed(1)) : null;
  const last30DaysAvgTempC = valid30Temp.length > 0 ? Number((valid30Temp.reduce((a, b) => a + b, 0) / valid30Temp.length).toFixed(1)) : null;

  const totalRainMm = validRain.length > 0 ? Number(validRain.reduce((a, b) => a + b, 0).toFixed(1)) : null;
  const estimatedAnnualEt0Mm = validEt0.length > 0 ? Number(validEt0.reduce((a, b) => a + b, 0).toFixed(0)) : null;
  const avgRootSoilWetness =
    validRootSm.length > 0 ? Number((validRootSm.reduce((a, b) => a + b, 0) / validRootSm.length).toFixed(3)) : null;

  const datasets: DatasetProvenance[] = STATIC_DATASETS.map((ds) => ({
    ...ds,
    observationDate: `${dailySeries[0]?.date ?? 'N/A'} to ${lastAvailableDate ?? 'N/A'}`,
    dataQuality: ds.id === 'power' || ds.id === 'gpm' || ds.id === 'smap' ? (dailySeries.length > 0 ? 'Verified Live' : 'Unavailable Locally') : 'Regional Context',
    missingObservations: ds.id === 'power' ? missingPowerObs : 0,
  }));

  const insights: EnvironmentalInsight[] = [
    {
      id: 'ins-rain',
      category: 'Rainfall',
      title: '180-Day Precipitation & Dry-Spell Pattern',
      observationType: 'Direct Satellite Observation',
      whatWasObserved:
        totalRainMm !== null
          ? `${totalRainMm} mm total rainfall across the last 180 days (last 30 days: ${last30DaysRainMm ?? 'N/A'} mm) with a longest dry break of ${longestDrySpellDays} days.`
          : 'NASA POWER rainfall records could not be retrieved for this query.',
      whenObserved: `${dailySeries[0]?.date ?? 'Past 180d'} – ${lastAvailableDate ?? 'Recent'}`,
      whatItCouldMean:
        totalRainMm !== null && totalRainMm < 350
          ? 'Moisture-conserving rotations (sorghum, cowpea, millet) are better suited than continuous high-water cereals.'
          : 'Supports maize-legume alternation if planting aligns with rainfall onset.',
      whatItCannotEstablish: 'Cannot resolve localized convective showers at single-plot scale.',
      additionalInfoNeeded: 'Confirm planting-week topsoil moisture by hand before sowing.',
      statusLevel: longestDrySpellDays >= 18 ? 'Watch' : 'Nominal',
    },
    {
      id: 'ins-soil',
      category: 'Soil Moisture',
      title: 'Assimilated Root-Zone Soil Moisture',
      observationType: 'Direct Satellite Observation',
      whatWasObserved:
        avgRootSoilWetness !== null
          ? `Assimilated 0–100 cm wetness averaged ${(avgRootSoilWetness * 100).toFixed(1)}%.`
          : 'Assimilated soil wetness unavailable.',
      whenObserved: 'Trailing 180-day daily series',
      whatItCouldMean: 'Indicates regional subsoil water availability for deeper-rooted crops.',
      whatItCannotEstablish: 'Cannot measure plot soil organic matter, pH, or crusting.',
      additionalInfoNeeded: 'Perform local soil pH and organic matter checks.',
      statusLevel: avgRootSoilWetness !== null && avgRootSoilWetness < 0.42 ? 'Watch' : 'Nominal',
    },
  ];

  const baseAnalysis: EnvironmentalAnalysis = {
    farmId: farm.id,
    fetchedAt: new Date().toISOString(),
    cacheHit: false,
    coordinates: { lat, lon },
    elevationMeters,
    terrainSlopePct,
    erosionRiskContext:
      terrainSlopePct === null
        ? 'DEM slope unavailable.'
        : terrainSlopePct < 2
        ? `Gentle slope (${terrainSlopePct}%) — low topographic runoff gradient.`
        : `Moderate-to-rolling slope (${terrainSlopePct}%) — contour bunds and mulch cover recommended.`,
    lastAvailableDate,
    periodSummary: {
      startDate: dailySeries[0]?.date ?? formatIsoDate(startStr),
      endDate: lastAvailableDate ?? formatIsoDate(endStr),
      totalRainMm,
      last30DaysRainMm,
      last30DaysAvgTempC,
      avgTempC: validTemp.length > 0 ? Number((validTemp.reduce((a, b) => a + b, 0) / validTemp.length).toFixed(1)) : null,
      maxTempObservedC: validTempMax.length > 0 ? Number(Math.max(...validTempMax).toFixed(1)) : null,
      heatStressDaysAbove35C: validTempMax.filter((v) => v >= 35).length,
      longestDrySpellDays,
      extremeRainDaysAbove30Mm: validRain.filter((v) => v >= 30).length,
      avgTopSoilWetness: validTopSm.length > 0 ? Number((validTopSm.reduce((a, b) => a + b, 0) / validTopSm.length).toFixed(3)) : null,
      avgRootSoilWetness,
      soilMoistureAnomalyPct: null,
      avgSolarRadiation: validSolar.length > 0 ? Number((validSolar.reduce((a, b) => a + b, 0) / validSolar.length).toFixed(1)) : null,
      estimatedAnnualEt0Mm,
      waterBalanceMm: totalRainMm !== null && estimatedAnnualEt0Mm !== null ? Number((totalRainMm - estimatedAnnualEt0Mm).toFixed(0)) : null,
      ndviProxyContext: 'Derived water-balance proxy paired with NASA GIBS MODIS orbital overlays.',
    },
    dailySeries,
    monthlySeries,
    climatology10Yr,
    datasets,
    insights,
    areasForInvestigation: [
      farm.soilPh === null ? 'Soil pH is unknown — conduct a simple field test before lime/fertilizer application.' : 'Verify pH uniformity across slopes.',
      'Check previous crop pest carryover before finalizing planting dates.',
    ],
  };

  const analysis: EnvironmentalAnalysis = {
    ...baseAnalysis,
    ...(forecast ? { realtimeForecast: forecast } : {}),
    hazards: evaluateStaticHazards(farm, baseAnalysis, forecast),
  };

  if (dailySeries.length > 0) {
    await writeFarmPowerCache(farm, analysis);
  }

  return {
    analysis,
    strategies: [],
  };
}

export function buildStaticStrategiesAndSimulation(
  farm: Farm,
  analysis: EnvironmentalAnalysis,
  crops: Crop[],
  params?: ClimateScenarioParams
): { strategies: RotationStrategy[]; simulation?: ClimateScenarioResult } {
  const strategies = generateRotationStrategies(farm, analysis, crops);
  if (!params) return { strategies };
  return {
    strategies,
    simulation: simulateClimateScenarios(farm, analysis, strategies, params),
  };
}
