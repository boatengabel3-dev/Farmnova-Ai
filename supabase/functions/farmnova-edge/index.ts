import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface EdgeRequestBody {
  action?: 'health' | 'nasa-telemetry' | 'weather-observations' | 'rotation-brief' | 'ai-advisor';
  payload?: Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function formatYyyymmdd(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

async function handleNasaTelemetry(payload: Record<string, unknown>) {
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const days = Math.min(365, Math.max(30, Number(payload.days ?? 180)));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Valid numeric lat and lon are required for nasa-telemetry.');
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const powerUrl =
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,T2M,T2M_MAX,GWETROOT` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${formatYyyymmdd(start)}&end=${formatYyyymmdd(end)}&format=JSON`;

  const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;

  const [powerRes, elevRes] = await Promise.all([fetch(powerUrl), fetch(elevUrl).catch(() => null)]);
  if (!powerRes.ok) {
    throw new Error(`NASA POWER request failed with status ${powerRes.status}`);
  }

  const powerJson = await powerRes.json();
  const fillValue = typeof powerJson?.header?.fill_value === 'number' ? powerJson.header.fill_value : -999;
  const params = powerJson?.properties?.parameter ?? {};
  const t2m = params.T2M ?? {};
  const t2mMax = params.T2M_MAX ?? {};
  const precip = params.PRECTOTCORR ?? {};
  const rootWet = params.GWETROOT ?? {};

  const dates = Object.keys(precip).sort();
  let totalRainMm = 0;
  let rainCount = 0;
  let tempSum = 0;
  let tempCount = 0;
  let heatDays = 0;
  let wetSum = 0;
  let wetCount = 0;
  let currentDry = 0;
  let longestDry = 0;
  let lastAvailableDate: string | null = null;

  for (const d of dates) {
    const p = Number(precip[d]);
    const t = Number(t2m[d]);
    const tx = Number(t2mMax[d]);
    const w = Number(rootWet[d]);
    const hasAny =
      (Number.isFinite(p) && p > -900 && p !== fillValue) ||
      (Number.isFinite(t) && t > -900 && t !== fillValue) ||
      (Number.isFinite(w) && w > -900 && w !== fillValue);

    if (hasAny) {
      lastAvailableDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    }

    if (Number.isFinite(p) && p > -900 && p !== fillValue) {
      totalRainMm += p;
      rainCount += 1;
      if (p < 1) {
        currentDry += 1;
        if (currentDry > longestDry) longestDry = currentDry;
      } else {
        currentDry = 0;
      }
    }
    if (Number.isFinite(t) && t > -900 && t !== fillValue) {
      tempSum += t;
      tempCount += 1;
    }
    if (Number.isFinite(tx) && tx > -900 && tx !== fillValue && tx >= 35) {
      heatDays += 1;
    }
    if (Number.isFinite(w) && w > -900 && w !== fillValue) {
      wetSum += w;
      wetCount += 1;
    }
  }

  let elevationMeters: number | null = null;
  if (elevRes && elevRes.ok) {
    const elevJson = await elevRes.json();
    const first = elevJson?.elevation?.[0];
    if (typeof first === 'number') elevationMeters = Math.round(first);
  }

  return {
    source: 'NASA POWER Daily Point API + SRTM Elevation (Supabase Edge)',
    coordinates: { lat, lon },
    lastAvailableDate,
    window: { start: dates[0] ?? null, end: lastAvailableDate, daysObserved: rainCount },
    elevationMeters,
    totalRainMm: rainCount > 0 ? Number(totalRainMm.toFixed(1)) : null,
    avgTempC: tempCount > 0 ? Number((tempSum / tempCount).toFixed(1)) : null,
    heatStressDaysAbove35C: heatDays,
    avgRootSoilWetness: wetCount > 0 ? Number((wetSum / wetCount).toFixed(3)) : null,
    longestDrySpellDays: longestDry,
  };
}

/**
 * Meteorological Weather API proxy (Meteomatics Weather API).
 * Docs: https://www.meteomatics.com/en/api/getting-started/
 * Base URL: https://api.meteomatics.com
 * Auth: Server-side Supabase secrets ONLY (never exposed to browser):
 *   - METEOMATICS_USERNAME & METEOMATICS_PASSWORD (recommended)
 *   - or METEOMATICS_API_TOKEN (pre-issued OAuth2 Bearer token)
 *   - or WEATHER_API_KEY in "username:password" format
 * Returns temperature in °C and rainfall in mm/day matching NASA POWER units.
 */
function cleanMeteomaticsVal(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Meteomatics reserved missing / not-applicable sentinels (-666, -777, -888, -999)
  if (n === -666 || n === -777 || n === -888 || n <= -900) return null;
  return Number(n.toFixed(2));
}

async function resolveMeteomaticsAuthHeaders(): Promise<Record<string, string> | null> {
  const staticToken = Deno.env.get('METEOMATICS_API_TOKEN')?.trim() || '';
  if (staticToken) {
    return { Authorization: `Bearer ${staticToken}` };
  }

  let username = Deno.env.get('METEOMATICS_USERNAME')?.trim() || '';
  let password = Deno.env.get('METEOMATICS_PASSWORD')?.trim() || '';

  if ((!username || !password) && Deno.env.get('WEATHER_API_KEY')?.includes(':')) {
    const combined = Deno.env.get('WEATHER_API_KEY')!.trim();
    const sep = combined.indexOf(':');
    username = combined.slice(0, sep).trim();
    password = combined.slice(sep + 1).trim();
  }

  if (!username || !password) {
    return null;
  }

  const basicEncoded = btoa(`${username}:${password}`);
  // Prefer Meteomatics OAuth2 token exchange as documented in Getting Started, fallback to HTTP Basic Auth
  try {
    const tokenRes = await fetch('https://login.meteomatics.com/api/v1/token', {
      headers: { Authorization: `Basic ${basicEncoded}` },
    });
    if (tokenRes.ok) {
      const tokenJson = await tokenRes.json();
      if (tokenJson?.access_token) {
        return { Authorization: `Bearer ${String(tokenJson.access_token)}` };
      }
    }
  } catch {
    // Fallback cleanly to direct HTTP Basic Auth
  }

  return { Authorization: `Basic ${basicEncoded}` };
}

async function handleWeatherObservations(payload: Record<string, unknown>) {
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const days = Math.min(90, Math.max(7, Number(payload.days ?? 30)));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Valid numeric lat and lon are required for weather-observations.');
  }

  const baseMeta = {
    sourceName: 'Meteomatics Weather API',
    spatialResolution: '~1–10 km downscaled mix grid',
    docsUrl: 'https://www.meteomatics.com/en/api/getting-started/',
    fetchedAt: new Date().toISOString(),
  };

  const authHeaders = await resolveMeteomaticsAuthHeaders();
  if (!authHeaders) {
    return {
      connected: false,
      ...baseMeta,
      lastAvailableDate: null,
      last30DaysRainMm: null,
      last30DaysAvgTempC: null,
      last30DaysMaxTempC: null,
      missingDaysCount: days,
      daily: [],
      errorMessage:
        'Weather service not connected yet (set METEOMATICS_USERNAME and METEOMATICS_PASSWORD in Supabase secrets).',
    };
  }

  // Query past `days` completed UTC days ending yesterday
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const startIso = `${start.toISOString().slice(0, 10)}T00:00:00Z`;
  const endIso = `${end.toISOString().slice(0, 10)}T00:00:00Z`;
  const parameters = 't_mean_2m_24h:C,t_max_2m_24h:C,precip_24h:mm';
  const location = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const url = `https://api.meteomatics.com/${startIso}--${endIso}:P1D/${parameters}/${location}/json`;

  const upstream = await fetch(url, { headers: authHeaders });
  if (!upstream.ok) {
    const statusHint =
      upstream.status === 401 || upstream.status === 403
        ? 'Meteomatics credentials rejected or plan lacks access (HTTP ' + upstream.status + ').'
        : `Weather service unavailable (HTTP ${upstream.status}).`;
    return {
      connected: false,
      ...baseMeta,
      lastAvailableDate: null,
      last30DaysRainMm: null,
      last30DaysAvgTempC: null,
      last30DaysMaxTempC: null,
      missingDaysCount: days,
      daily: [],
      errorMessage: `Weather service not connected yet — ${statusHint}`,
    };
  }

  const json = await upstream.json();
  const dataSeries: Array<{
    parameter?: string;
    coordinates?: Array<{ dates?: Array<{ date?: string; value?: unknown }> }>;
  }> = Array.isArray(json?.data) ? json.data : [];

  const byDate = new Map<
    string,
    { date: string; tempMeanC: number | null; tempMaxC: number | null; precipMm: number | null }
  >();

  for (const paramBlock of dataSeries) {
    const paramName = String(paramBlock?.parameter || '');
    const coordDates = paramBlock?.coordinates?.[0]?.dates;
    if (!Array.isArray(coordDates)) continue;

    for (const pt of coordDates) {
      const isoDate = String(pt?.date || '').slice(0, 10);
      if (!isoDate) continue;
      const entry = byDate.get(isoDate) ?? {
        date: isoDate,
        tempMeanC: null,
        tempMaxC: null,
        precipMm: null,
      };
      const val = cleanMeteomaticsVal(pt?.value);
      if (paramName.startsWith('t_mean_2m_24h')) entry.tempMeanC = val;
      else if (paramName.startsWith('t_max_2m_24h')) entry.tempMaxC = val;
      else if (paramName.startsWith('precip_24h')) entry.precipMm = val;
      byDate.set(isoDate, entry);
    }
  }

  const daily = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  const recent30 = daily.slice(-30);
  const validRain = recent30.map((d) => d.precipMm).filter((v): v is number => v !== null);
  const validTemp = recent30.map((d) => d.tempMeanC).filter((v): v is number => v !== null);
  const validTMax = recent30.map((d) => d.tempMaxC).filter((v): v is number => v !== null);
  const missingDaysCount = recent30.filter((d) => d.precipMm === null || d.tempMeanC === null).length;

  let lastAvailableDate: string | null = null;
  for (let i = recent30.length - 1; i >= 0; i--) {
    if (recent30[i].precipMm !== null || recent30[i].tempMeanC !== null) {
      lastAvailableDate = recent30[i].date;
      break;
    }
  }

  return {
    connected: true,
    ...baseMeta,
    lastAvailableDate,
    last30DaysRainMm: validRain.length > 0 ? Number(validRain.reduce((s, v) => s + v, 0).toFixed(1)) : null,
    last30DaysAvgTempC: validTemp.length > 0 ? Number((validTemp.reduce((s, v) => s + v, 0) / validTemp.length).toFixed(1)) : null,
    last30DaysMaxTempC: validTMax.length > 0 ? Number(Math.max(...validTMax).toFixed(1)) : null,
    missingDaysCount,
    daily: recent30,
  };
}

function handleRotationBrief(payload: Record<string, unknown>) {
  const farmName = String(payload.farmName || 'Registered Farm');
  const region = String(payload.region || '');
  const country = String(payload.country || '');
  const soilPh = payload.soilPh ?? null;
  const organicMatterPct = payload.organicMatterPct ?? null;
  const totalRainMm = typeof payload.totalRainMm === 'number' ? payload.totalRainMm : null;
  const avgRootSoilWetness = typeof payload.avgRootSoilWetness === 'number' ? payload.avgRootSoilWetness : null;
  const heatStressDays = typeof payload.heatStressDaysAbove35C === 'number' ? payload.heatStressDaysAbove35C : 0;
  const longestDrySpell = typeof payload.longestDrySpellDays === 'number' ? payload.longestDrySpellDays : 0;
  const currentCrops = Array.isArray(payload.currentCrops) ? payload.currentCrops.map(String) : [];
  const strategies = Array.isArray(payload.strategies) ? payload.strategies : [];

  const dataGaps: string[] = [];
  if (soilPh === null || soilPh === undefined) dataGaps.push('Laboratory soil pH measurement is missing.');
  if (organicMatterPct === null || organicMatterPct === undefined) dataGaps.push('Soil organic matter (%) has not been tested.');
  if (currentCrops.length === 0) dataGaps.push('Current standing crop list is empty.');

  const alerts: string[] = [];
  if (longestDrySpell >= 14) {
    alerts.push(`Dry-spell alert: ${longestDrySpell} consecutive days < 1 mm rain observed in the regional NASA POWER grid.`);
  }
  if (heatStressDays >= 15) {
    alerts.push(`Thermal exposure: ${heatStressDays} days reached >= 35°C, elevating flowering-stage heat sensitivity.`);
  }
  if (avgRootSoilWetness !== null && avgRootSoilWetness < 0.45) {
    alerts.push(`Subsoil moisture watch: Assimilated 0-100 cm wetness index averaged ${(avgRootSoilWetness * 100).toFixed(1)}%.`);
  }

  return {
    farmName,
    location: [region, country].filter(Boolean).join(', '),
    summary: [
      `FarmNova AI Edge Briefing for ${farmName}:`,
      totalRainMm !== null
        ? `• Observed Rainfall: ${totalRainMm} mm across the active NASA POWER window (longest dry spell: ${longestDrySpell} days).`
        : '• Observed Rainfall: Unavailable in payload.',
      avgRootSoilWetness !== null
        ? `• Root-Zone Wetness (0–100 cm): ${(avgRootSoilWetness * 100).toFixed(1)}% regional assimilated index (0.5° grid).`
        : '• Root-Zone Wetness: Unavailable in payload.',
      strategies.length > 0
        ? `• Evaluated Rotation Paths (${strategies.length}): ${strategies.map((s: any) => `${s.label} — ${s.title}`).join(' | ')}`
        : '• Rotation Paths: Evaluate cereal-legume alternation with local extension verification.',
      alerts.length > 0 ? `• Climate & Moisture Advisories:\n  - ${alerts.join('\n  - ')}` : '• Climate & Moisture Advisories: Within nominal seasonal ranges for this window.',
      dataGaps.length > 0
        ? `• Missing Local Field Evidence (Verify On-Site):\n  - ${dataGaps.join('\n  - ')}`
        : '• Local Soil Inputs: Core soil pH and organic matter entries recorded; confirm spatial variability by walking the plot.',
    ].join('\n'),
    alerts,
    dataGaps,
  };
}

async function handleAiAdvisor(payload: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in Supabase Edge Function secrets.');
  }

  const model = String(payload.modelName || 'gemini-2.5-flash');
  const question = String(payload.question || '').trim();
  const contextSummary = String(payload.contextSummary || '');

  if (!question) {
    throw new Error('Question is required for ai-advisor.');
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const geminiRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [
          {
            text: `You are FarmNova AI's Agricultural Intelligence Assistant running inside a Supabase Edge Function.
Never invent satellite measurements or yields. Separate direct satellite observations, derived indicators, agronomic guidance, and local field unknowns.`,
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: `${contextSummary ? `Farm Context:\n${contextSummary}\n\n` : ''}Question: ${question}` }],
        },
      ],
    }),
  });

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    throw new Error(`Gemini upstream error (${geminiRes.status}): ${errText.slice(0, 200)}`);
  }

  const geminiJson = await geminiRes.json();
  const answer = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!answer) {
    throw new Error('Gemini returned an empty response.');
  }

  return { answer, modelUsed: model };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const authHeader = req.headers.get('Authorization');

    let authenticatedUserId: string | null = null;
    if (supabaseUrl && supabaseAnonKey && authHeader?.startsWith('Bearer ')) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await supabase.auth.getUser();
      authenticatedUserId = data?.user?.id ?? null;
    }

    const body = (await req.json().catch(() => ({}))) as EdgeRequestBody;
    const action = body.action ?? 'health';
    const payload = body.payload ?? {};

    let data: unknown;
    switch (action) {
      case 'health':
        data = {
          service: 'FarmNova AI Edge',
          functionSlug: 'farmnova-edge',
          runtime: 'deno-edge',
          status: 'healthy',
          supportedActions: ['health', 'nasa-telemetry', 'weather-observations', 'rotation-brief', 'ai-advisor'],
          authenticatedUserId,
          timestamp: new Date().toISOString(),
        };
        break;
      case 'nasa-telemetry':
        data = await handleNasaTelemetry(payload);
        break;
      case 'weather-observations':
        data = await handleWeatherObservations(payload);
        break;
      case 'rotation-brief':
        data = handleRotationBrief(payload);
        break;
      case 'ai-advisor':
        data = await handleAiAdvisor(payload);
        break;
      default:
        return jsonResponse({ ok: false, error: `Unsupported Edge Function action: ${String(action)}` }, 400);
    }

    return jsonResponse({
      ok: true,
      action,
      functionSlug: 'farmnova-edge',
      runtime: 'supabase-edge',
      executedAt: new Date().toISOString(),
      data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected Edge Function error.';
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
