import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface EdgeRequestBody {
  action?: 'health' | 'nasa-telemetry' | 'rotation-brief' | 'ai-advisor';
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
  const days = Math.min(365, Math.max(30, Number(payload.days ?? 120)));

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('Valid numeric lat and lon are required for nasa-telemetry.');
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 4);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);

  const powerUrl =
    `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,T2M_MAX,PRECTOTCORR,GWETROOT` +
    `&community=AG&longitude=${lon.toFixed(4)}&latitude=${lat.toFixed(4)}` +
    `&start=${formatYyyymmdd(start)}&end=${formatYyyymmdd(end)}&format=JSON`;

  const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`;

  const [powerRes, elevRes] = await Promise.all([fetch(powerUrl), fetch(elevUrl).catch(() => null)]);
  if (!powerRes.ok) {
    throw new Error(`NASA POWER request failed with status ${powerRes.status}`);
  }

  const powerJson = await powerRes.json();
  const params = powerJson?.properties?.parameter ?? {};
  const t2m = params.T2M ?? {};
  const t2mMax = params.T2M_MAX ?? {};
  const precip = params.PRECTOTCORR ?? {};
  const rootWet = params.GWETROOT ?? {};

  const dates = Object.keys(precip).sort();
  let totalRainMm = 0;
  let tempSum = 0;
  let tempCount = 0;
  let heatDays = 0;
  let wetSum = 0;
  let wetCount = 0;
  let currentDry = 0;
  let longestDry = 0;

  for (const d of dates) {
    const p = Number(precip[d]);
    if (Number.isFinite(p) && p > -900) {
      totalRainMm += p;
      if (p < 1) {
        currentDry += 1;
        if (currentDry > longestDry) longestDry = currentDry;
      } else {
        currentDry = 0;
      }
    }
    const t = Number(t2m[d]);
    if (Number.isFinite(t) && t > -900) {
      tempSum += t;
      tempCount += 1;
    }
    const tx = Number(t2mMax[d]);
    if (Number.isFinite(tx) && tx > -900 && tx >= 35) {
      heatDays += 1;
    }
    const w = Number(rootWet[d]);
    if (Number.isFinite(w) && w > -900) {
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
    source: 'NASA POWER + SRTM Elevation (Supabase Edge)',
    coordinates: { lat, lon },
    window: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null, daysObserved: dates.length },
    elevationMeters,
    totalRainMm: Number(totalRainMm.toFixed(1)),
    avgTempC: tempCount > 0 ? Number((tempSum / tempCount).toFixed(1)) : null,
    heatStressDaysAbove35C: heatDays,
    avgRootSoilWetness: wetCount > 0 ? Number((wetSum / wetCount).toFixed(3)) : null,
    longestDrySpellDays: longestDry,
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
          supportedActions: ['health', 'nasa-telemetry', 'rotation-brief', 'ai-advisor'],
          authenticatedUserId,
          timestamp: new Date().toISOString(),
        };
        break;
      case 'nasa-telemetry':
        data = await handleNasaTelemetry(payload);
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
