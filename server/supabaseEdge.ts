import { createClient } from '@supabase/supabase-js';
import { fetchFarmEnvironmentalAnalysis } from './nasa.ts';
import { generateRotationStrategies } from './rotationEngine.ts';
import { askAgriAssistant } from './aiAssistant.ts';
import type { Crop, EnvironmentalAnalysis, Farm, RotationStrategy } from '../src/types.ts';

export type EdgeAction = 'health' | 'nasa-telemetry' | 'rotation-brief' | 'ai-advisor';

export interface SupabaseEdgeStatus {
  configured: boolean;
  functionSlug: string;
  mode: 'supabase-remote' | 'local-edge-bridge';
  endpoint: string;
  supportedActions: EdgeAction[];
}

export interface EdgeInvokeResult {
  ok: boolean;
  action: EdgeAction;
  functionSlug: string;
  runtime: 'supabase-edge' | 'local-edge-bridge';
  executedAt: string;
  data: Record<string, unknown>;
}

function normalizeSupabaseUrl(raw: string | undefined): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (/^[a-z0-9-]+$/i.test(trimmed)) return `https://${trimmed}.supabase.co`;
  return '';
}

function resolveSupabaseConfig() {
  const url =
    normalizeSupabaseUrl(process.env.SUPABASE_URL) ||
    normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL) ||
    normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  const functionSlug = (
    process.env.SUPABASE_EDGE_FUNCTION_SLUG ||
    process.env.VITE_SUPABASE_EDGE_FUNCTION_SLUG ||
    'farmnova-edge'
  ).trim();

  const configured = Boolean(url && key && url.startsWith('http'));
  return { url, key, functionSlug, configured };
}

export function getSupabaseEdgeStatus(): SupabaseEdgeStatus {
  const { url, functionSlug, configured } = resolveSupabaseConfig();
  return {
    configured,
    functionSlug,
    mode: configured ? 'supabase-remote' : 'local-edge-bridge',
    endpoint: configured ? `${url.replace(/\/+$/, '')}/functions/v1/${functionSlug}` : `/api/edge/invoke (${functionSlug})`,
    supportedActions: ['health', 'nasa-telemetry', 'rotation-brief', 'ai-advisor'],
  };
}

function buildLocalRotationBrief(
  farm: Farm | null,
  analysis: EnvironmentalAnalysis | null,
  strategies: RotationStrategy[],
  payload: Record<string, unknown>
) {
  const farmName = farm?.name || String(payload.farmName || 'Registered Farm');
  const location = farm ? `${farm.region}, ${farm.country}` : [payload.region, payload.country].filter(Boolean).join(', ');
  const soilPh = farm ? farm.soilPh : payload.soilPh ?? null;
  const organicMatterPct = farm ? farm.organicMatterPct : payload.organicMatterPct ?? null;
  const currentCrops = farm ? farm.currentCrops : Array.isArray(payload.currentCrops) ? payload.currentCrops.map(String) : [];

  const totalRainMm = analysis?.periodSummary.totalRainMm ?? (typeof payload.totalRainMm === 'number' ? payload.totalRainMm : null);
  const avgRootSoilWetness =
    analysis?.periodSummary.avgRootSoilWetness ?? (typeof payload.avgRootSoilWetness === 'number' ? payload.avgRootSoilWetness : null);
  const longestDrySpell =
    analysis?.periodSummary.longestDrySpellDays ?? (typeof payload.longestDrySpellDays === 'number' ? payload.longestDrySpellDays : 0);
  const heatStressDays =
    analysis?.periodSummary.heatStressDaysAbove35C ?? (typeof payload.heatStressDaysAbove35C === 'number' ? payload.heatStressDaysAbove35C : 0);

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
    location,
    summary: [
      `FarmNova AI Edge Briefing for ${farmName}:`,
      totalRainMm !== null
        ? `• Observed Rainfall: ${totalRainMm} mm across the active NASA POWER window (longest dry spell: ${longestDrySpell} days).`
        : '• Observed Rainfall: Unavailable.',
      avgRootSoilWetness !== null
        ? `• Root-Zone Wetness (0–100 cm): ${(avgRootSoilWetness * 100).toFixed(1)}% regional assimilated index (0.5° grid).`
        : '• Root-Zone Wetness: Unavailable.',
      strategies.length > 0
        ? `• Evaluated Rotation Paths (${strategies.length}): ${strategies.map((s) => `${s.label} — ${s.title}`).join(' | ')}`
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

export async function invokeSupabaseEdge(
  action: EdgeAction,
  payload: Record<string, unknown>,
  context?: {
    farm?: Farm | null;
    crops?: Crop[];
    analysis?: EnvironmentalAnalysis | null;
    strategies?: RotationStrategy[];
  }
): Promise<EdgeInvokeResult> {
  const { url, key, functionSlug, configured } = resolveSupabaseConfig();
  const farm = context?.farm ?? null;

  let analysis = context?.analysis ?? null;
  let strategies = context?.strategies ?? [];

  if (farm && (!analysis || strategies.length === 0) && (action === 'rotation-brief' || action === 'ai-advisor' || action === 'nasa-telemetry')) {
    analysis = analysis ?? (await fetchFarmEnvironmentalAnalysis(farm, false));
    if (strategies.length === 0 && context?.crops) {
      strategies = generateRotationStrategies(farm, analysis, context.crops);
    }
  }

  const enrichedPayload: Record<string, unknown> = {
    ...payload,
    ...(farm
      ? {
          farmId: farm.id,
          farmName: farm.name,
          region: farm.region,
          country: farm.country,
          lat: farm.centroidLat,
          lon: farm.centroidLon,
          soilPh: farm.soilPh,
          organicMatterPct: farm.organicMatterPct,
          currentCrops: farm.currentCrops,
        }
      : {}),
    ...(analysis
      ? {
          totalRainMm: analysis.periodSummary.totalRainMm,
          avgTempC: analysis.periodSummary.avgTempC,
          avgRootSoilWetness: analysis.periodSummary.avgRootSoilWetness,
          longestDrySpellDays: analysis.periodSummary.longestDrySpellDays,
          heatStressDaysAbove35C: analysis.periodSummary.heatStressDaysAbove35C,
        }
      : {}),
    ...(strategies.length > 0
      ? {
          strategies: strategies.map((s) => ({
            id: s.id,
            label: s.label,
            title: s.title,
            subtitle: s.subtitle,
          })),
        }
      : {}),
  };

  // Attempt live Supabase Edge Function invocation when credentials are configured
  if (configured) {
    try {
      const supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.functions.invoke(functionSlug, {
        body: { action, payload: enrichedPayload },
      });

      if (!error && data && typeof data === 'object' && (data as any).ok !== false) {
        return {
          ok: true,
          action,
          functionSlug,
          runtime: 'supabase-edge',
          executedAt: (data as any).executedAt || new Date().toISOString(),
          data: ((data as any).data ?? data) as Record<string, unknown>,
        };
      }
    } catch {
      // Fall through cleanly to local Edge bridge if remote Supabase endpoint is unreachable
    }
  }

  // Local Edge Bridge fallback matching the exact farmnova-edge contract
  let localData: Record<string, unknown>;
  switch (action) {
    case 'health':
      localData = {
        service: 'FarmNova AI Edge',
        functionSlug,
        runtime: 'local-edge-bridge',
        status: 'healthy',
        supabaseConfigured: configured,
        supportedActions: ['health', 'nasa-telemetry', 'rotation-brief', 'ai-advisor'],
        timestamp: new Date().toISOString(),
      };
      break;

    case 'nasa-telemetry': {
      if (analysis) {
        localData = {
          source: 'NASA POWER + SRTM Elevation (Local Edge Bridge)',
          coordinates: analysis.coordinates,
          window: {
            start: analysis.periodSummary.startDate,
            end: analysis.periodSummary.endDate,
            daysObserved: analysis.dailySeries.length,
          },
          elevationMeters: analysis.elevationMeters,
          totalRainMm: analysis.periodSummary.totalRainMm,
          avgTempC: analysis.periodSummary.avgTempC,
          heatStressDaysAbove35C: analysis.periodSummary.heatStressDaysAbove35C,
          avgRootSoilWetness: analysis.periodSummary.avgRootSoilWetness,
          longestDrySpellDays: analysis.periodSummary.longestDrySpellDays,
        };
      } else {
        const lat = Number(enrichedPayload.lat ?? 7.3833);
        const lon = Number(enrichedPayload.lon ?? -1.3667);
        const tempFarm: Farm = {
          id: 'edge-probe',
          ownerId: 'edge',
          name: 'Edge Probe',
          country: '',
          region: '',
          district: '',
          sizeHectares: 1,
          farmingType: 'Probe',
          centroidLat: lat,
          centroidLon: lon,
          polygonCoords: [],
          soilType: 'Unknown',
          soilTexture: 'Unknown',
          drainage: 'Unknown',
          soilFertility: 'Unknown',
          organicMatterPct: null,
          soilPh: null,
          irrigationAvailable: 'Unknown',
          soilNotes: '',
          previousCrops: [],
          currentCrops: [],
          plannedCrops: [],
          plantingSeasons: '',
          harvestPeriods: '',
          pestHistory: '',
          availableWater: '',
          equipmentNotes: '',
          marketPreferences: '',
          priorities: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        const probeAnalysis = await fetchFarmEnvironmentalAnalysis(tempFarm, false);
        localData = {
          source: 'NASA POWER + SRTM Elevation (Local Edge Bridge)',
          coordinates: probeAnalysis.coordinates,
          window: {
            start: probeAnalysis.periodSummary.startDate,
            end: probeAnalysis.periodSummary.endDate,
            daysObserved: probeAnalysis.dailySeries.length,
          },
          elevationMeters: probeAnalysis.elevationMeters,
          totalRainMm: probeAnalysis.periodSummary.totalRainMm,
          avgTempC: probeAnalysis.periodSummary.avgTempC,
          heatStressDaysAbove35C: probeAnalysis.periodSummary.heatStressDaysAbove35C,
          avgRootSoilWetness: probeAnalysis.periodSummary.avgRootSoilWetness,
          longestDrySpellDays: probeAnalysis.periodSummary.longestDrySpellDays,
        };
      }
      break;
    }

    case 'rotation-brief':
      localData = buildLocalRotationBrief(farm, analysis, strategies, enrichedPayload);
      break;

    case 'ai-advisor': {
      const question = String(enrichedPayload.question || '').trim();
      if (!question) {
        throw new Error('Question is required for ai-advisor.');
      }
      if (!farm || !analysis) {
        throw new Error('A registered farm context is required for ai-advisor.');
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
    runtime: 'local-edge-bridge',
    executedAt: new Date().toISOString(),
    data: localData,
  };
}
