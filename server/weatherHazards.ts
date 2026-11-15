import { db } from './db.ts';
import type {
  EnvironmentalAnalysis,
  Farm,
  FarmHazard,
  ForecastDay,
  RealtimeWeatherForecast,
} from '../src/types.ts';

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

export async function fetchRealtimeForecast(lat: number, lon: number, forceRefresh = false): Promise<RealtimeWeatherForecast> {
  const rLat = Number(lat.toFixed(4));
  const rLon = Number(lon.toFixed(4));
  const cacheKey = `rt_wx_${rLat}_${rLon}_v1`;

  if (!forceRefresh) {
    const cached = db
      .prepare(`SELECT payload_json, expires_at FROM nasa_cache WHERE cache_key = ?`)
      .get(cacheKey) as { payload_json: string; expires_at: number } | undefined;

    if (cached && cached.expires_at > Date.now()) {
      return JSON.parse(cached.payload_json) as RealtimeWeatherForecast;
    }
  }

  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${rLat}&longitude=${rLon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,et0_fao_evapotranspiration,uv_index_max` +
    `&forecast_days=7&timezone=auto`;

  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`Real-time weather service returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as any;
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

  const weeklyRainTotalMm = Number(
    daily.reduce((sum, d) => sum + (d.precipSumMm ?? 0), 0).toFixed(1)
  );
  const maxTemps = daily.map((d) => d.tempMaxC).filter((v): v is number => v !== null);
  const minTemps = daily.map((d) => d.tempMinC).filter((v): v is number => v !== null);

  const forecast: RealtimeWeatherForecast = {
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

  // Short 15-minute TTL so forecast stays genuinely real-time
  db.prepare(
    `INSERT OR REPLACE INTO nasa_cache (cache_key, payload_json, fetched_at, expires_at)
     VALUES (?, ?, ?, ?)`
  ).run(cacheKey, JSON.stringify(forecast), forecast.fetchedAt, Date.now() + 15 * 60 * 1000);

  return forecast;
}

export function evaluatePotentialHazards(
  farm: Farm,
  analysis: EnvironmentalAnalysis,
  forecast: RealtimeWeatherForecast | null
): FarmHazard[] {
  const hazards: FarmHazard[] = [];
  const days = forecast?.daily ?? [];

  // 1. Heavy Rain / Flash Flood / Soil Washout
  const heavyDays = days.filter((d) => (d.precipSumMm ?? 0) >= 25 || (d.weatherCode ?? 0) >= 95);
  const peakRainDay = days.reduce<ForecastDay | null>(
    (best, d) => (!best || (d.precipSumMm ?? 0) > (best.precipSumMm ?? 0) ? d : best),
    null
  );
  const maxDailyRain = peakRainDay?.precipSumMm ?? 0;
  const slope = analysis.terrainSlopePct ?? 0;

  if (maxDailyRain >= 35 || (heavyDays.length >= 2 && slope >= 3)) {
    hazards.push({
      id: 'haz-flood',
      type: 'Flood / Heavy Rain',
      title: 'Heavy Rain & Field Washout Risk',
      severity: maxDailyRain >= 50 || slope >= 6 ? 'Severe' : 'High',
      timingWindow: peakRainDay ? `${peakRainDay.dayLabel} (${peakRainDay.date})` : 'Next 7 days',
      plainSummary: `Strong rain up to ${maxDailyRain} mm in a single day could waterlog low areas or wash away topsoil and newly applied fertilizer.`,
      triggerDetail: `7-day live forecast peak ${maxDailyRain} mm/day · Terrain slope ${analysis.terrainSlopePct ?? 'unknown'}%`,
      farmerActions: [
        'Clear field drainage ditches and bunds before heavy rain arrives.',
        'Delay top-dressing fertilizer or herbicide spraying until heavy showers pass.',
        'Keep crop mulch or cover strips intact on sloping ground.',
      ],
    });
  } else if (maxDailyRain >= 18) {
    hazards.push({
      id: 'haz-rain-mod',
      type: 'Flood / Heavy Rain',
      title: 'Moderate Storm Showers Expected',
      severity: 'Moderate',
      timingWindow: peakRainDay ? `${peakRainDay.dayLabel} (${peakRainDay.date})` : 'Next 7 days',
      plainSummary: `Rain showers up to ${maxDailyRain} mm/day are expected. Good for moisture, though spraying may wash off.`,
      triggerDetail: `Forecast daily peak ${maxDailyRain} mm`,
      farmerActions: [
        'Apply foliar sprays or fertilizers on dry mornings at least 6 hours before rain.',
        'Check gentle slopes for small water channels.',
      ],
    });
  }

  // 2. Heatwave & Pollination Stress
  const hotForecastDays = days.filter((d) => (d.tempMaxC ?? 0) >= 35);
  const peakTemp = forecast?.maxForecastTempC ?? analysis.periodSummary.maxTempObservedC ?? 0;
  if (hotForecastDays.length >= 2 || peakTemp >= 37 || analysis.periodSummary.heatStressDaysAbove35C >= 20) {
    hazards.push({
      id: 'haz-heat',
      type: 'Heatwave',
      title: 'High Heat & Crop Wilting Stress',
      severity: peakTemp >= 39 || hotForecastDays.length >= 4 ? 'High' : 'Moderate',
      timingWindow: hotForecastDays.length > 0 ? `${hotForecastDays.length} days in next 7 days` : 'Seasonal NASA pattern',
      plainSummary: `Daytime temperatures reaching ${peakTemp}°C can stress young seedlings and reduce grain-filling if crops are flowering.`,
      triggerDetail: `Forecast peak ${peakTemp}°C · ${analysis.periodSummary.heatStressDaysAbove35C} past-year days >=35°C`,
      farmerActions: [
        'Keep crop residue mulch on bare soil to cool the root zone.',
        'Schedule watering or transplanting early in the morning or late afternoon.',
        'Prefer heat-tolerant varieties for upcoming sowings.',
      ],
    });
  }

  // 3. Dry Spell / Moisture Deficit
  const weekRain = forecast?.weeklyRainTotalMm ?? 0;
  const rootWetPct = analysis.periodSummary.avgRootSoilWetness !== null ? analysis.periodSummary.avgRootSoilWetness * 100 : null;
  if (weekRain < 4 && ((rootWetPct !== null && rootWetPct < 45) || analysis.periodSummary.longestDrySpellDays >= 16)) {
    hazards.push({
      id: 'haz-dry',
      type: 'Dry Spell / Drought',
      title: 'Dry Week & Low Soil Moisture',
      severity: weekRain < 1 && rootWetPct !== null && rootWetPct < 38 ? 'High' : 'Moderate',
      timingWindow: 'Next 7 days',
      plainSummary: `Very little rain (${weekRain} mm total) is forecast this week while deeper soil moisture sits near ${rootWetPct !== null ? `${rootWetPct.toFixed(0)}%` : 'low levels'}.`,
      triggerDetail: `7-day forecast rain: ${weekRain} mm · NASA root-zone wetness: ${rootWetPct !== null ? `${rootWetPct.toFixed(1)}%` : 'N/A'}`,
      farmerActions: [
        'Hold off dry sowing until soil is moist at 5–10 cm depth.',
        'Weed early so weeds do not steal scarce moisture from crops.',
        'Use tied ridges or mulch basins to trap the next rainfall.',
      ],
    });
  }

  // 4. High Wind / Crop Lodging
  const maxGust = Math.max(0, ...days.map((d) => d.windGustMaxKmh ?? 0));
  if (maxGust >= 45) {
    hazards.push({
      id: 'haz-wind',
      type: 'High Wind',
      title: 'Strong Wind Gusts & Stalk Lodging Risk',
      severity: maxGust >= 65 ? 'High' : 'Moderate',
      timingWindow: 'Next 7 days',
      plainSummary: `Wind gusts up to ${maxGust} km/h can bend tall maize/sorghum stalks, drift sprays, and dry topsoil quickly.`,
      triggerDetail: `Forecast peak gusts ${maxGust} km/h`,
      farmerActions: [
        'Avoid pesticide or foliar spraying during windy hours to prevent drift.',
        'Earth up soil around the base of tall cereals to support roots.',
      ],
    });
  }

  // 5. Humid / Fungal Disease Window (Warm + Wet + High Humidity)
  const wetDaysCount = days.filter((d) => (d.precipSumMm ?? 0) >= 3).length;
  const curHumidity = forecast?.current.humidityPct ?? 0;
  const curTemp = forecast?.current.temperatureC ?? 25;
  if ((wetDaysCount >= 3 || curHumidity >= 82) && curTemp >= 18 && curTemp <= 33) {
    hazards.push({
      id: 'haz-fungal',
      type: 'Fungal / Humidity',
      title: 'Humid Leaf Blight & Mold Window',
      severity: wetDaysCount >= 4 && curHumidity >= 85 ? 'High' : 'Moderate',
      timingWindow: 'Next 5–7 days',
      plainSummary: `Warm weather with ${wetDaysCount} rainy days and high humidity makes leaf spot, rust, and storage mold spread faster.`,
      triggerDetail: `Current humidity ${curHumidity}% · ${wetDaysCount} rainy days ahead`,
      farmerActions: [
        'Scout lower leaves for yellow/brown spots and remove severely infected leaves.',
        'Do not store damp harvested grain; dry thoroughly on clean tarps.',
      ],
    });
  }

  // 6. Global Cold / Frost Alert (for highland or temperate farms worldwide)
  const minTemp = forecast?.minForecastTempC;
  if (minTemp !== null && minTemp !== undefined && minTemp <= 4) {
    hazards.push({
      id: 'haz-frost',
      type: 'Frost / Cold',
      title: 'Cold Night & Frost Injury Risk',
      severity: minTemp <= 0 ? 'Severe' : 'High',
      timingWindow: 'Next 7 days',
      plainSummary: `Nighttime temperatures dropping to ${minTemp}°C can damage tender seedlings, vegetables, and flowering crops.`,
      triggerDetail: `Forecast 7-day minimum ${minTemp}°C`,
      farmerActions: [
        'Delay planting warm-season crops until nights stay warmer.',
        'Cover sensitive seedlings or apply light irrigation before frost nights.',
      ],
    });
  }

  // 7. Always include a calm baseline card if no acute hazards exist
  if (hazards.length === 0) {
    hazards.push({
      id: 'haz-nominal',
      type: 'Dry Spell / Drought',
      title: 'No Acute Weather Hazards Detected',
      severity: 'Low',
      timingWindow: 'Next 7 days',
      plainSummary: `Current 7-day live weather for ${farm.name} stays within manageable temperature, wind, and rainfall bounds.`,
      triggerDetail: `7-day rain ${weekRain} mm · Peak ${forecast?.maxForecastTempC ?? 'N/A'}°C`,
      farmerActions: [
        'Good window for routine weeding, scouting, and scheduled field work.',
        'Check soil moisture by hand at 15 cm depth before planting.',
      ],
    });
  }

  return hazards;
}
