import { jsPDF } from 'jspdf';
import type {
  Announcement,
  ClimateScenarioParams,
  ClimateScenarioResult,
  Crop,
  EnvironmentalAnalysis,
  Farm,
  RotationStrategy,
  User,
} from '../types';

import { getSupabaseClient, isSupabaseClientConfigured, SUPABASE_EDGE_FUNCTION_SLUG } from './supabase';
import { handleStaticApiFallback } from './staticFallback';

const TOKEN_KEY = 'farmnova_session_token';
const LEGACY_TOKEN_KEY = 'terravane_session_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(path, { ...options, headers });
    const contentType = res.headers.get('content-type') || '';
    const isMissingApiRoute =
      res.status === 404 ||
      res.status === 405 ||
      res.status === 501 ||
      (res.ok && !contentType.includes('application/json'));

    if (isMissingApiRoute) {
      return await handleStaticApiFallback<T>(path, options, headers);
    }

    if (!res.ok) {
      let errMsg = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body?.error) errMsg = body.error;
      } catch {
        // ignore json parse failure
      }
      throw new Error(errMsg);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof TypeError) {
      return await handleStaticApiFallback<T>(path, options, headers);
    }
    throw err;
  }
}

export const api = {
  // Auth
  me: () => apiFetch<{ user: User }>('/api/auth/me'),
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (payload: { email: string; password: string; name: string; role: string; organization?: string; region?: string }) =>
    apiFetch<{ token: string; user: User; verificationToken: string; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  verifyEmail: (email: string, token: string) =>
    apiFetch<{ verified: boolean; user?: User; message?: string }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ email, token }),
    }),
  resendVerification: () =>
    apiFetch<{ verificationToken: string; message: string }>('/api/auth/resend-verification', { method: 'POST' }),
  forgotPassword: (email: string) =>
    apiFetch<{ message: string; demoRecoveryToken?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (email: string, token: string, newPassword: string) =>
    apiFetch<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, token, newPassword }),
    }),
  updateProfile: (payload: Partial<Pick<User, 'name' | 'organization' | 'region' | 'preferredUnits'>>) =>
    apiFetch<{ user: User }>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Announcements
  announcements: () => apiFetch<{ announcements: Announcement[] }>('/api/announcements'),

  // Farms
  listFarms: () => apiFetch<{ farms: Farm[] }>('/api/farms'),
  createFarm: (payload: Partial<Farm>) =>
    apiFetch<{ farm: Farm }>('/api/farms', { method: 'POST', body: JSON.stringify(payload) }),
  updateFarm: (id: string, payload: Partial<Farm>) =>
    apiFetch<{ farm: Farm }>(`/api/farms/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFarm: (id: string) => apiFetch<{ ok: boolean }>(`/api/farms/${id}`, { method: 'DELETE' }),

  // Analysis & Rotation
  getFarmAnalysis: (id: string, refresh = false) =>
    apiFetch<{ farm: Farm; analysis: EnvironmentalAnalysis; strategies: RotationStrategy[] }>(
      `/api/farms/${id}/analysis${refresh ? '?refresh=1' : ''}`
    ),
  getRealtimeForecast: (id: string, refresh = false) =>
    apiFetch<{
      realtimeForecast: NonNullable<EnvironmentalAnalysis['realtimeForecast']>;
      hazards: NonNullable<EnvironmentalAnalysis['hazards']>;
    }>(`/api/farms/${id}/forecast${refresh ? '?refresh=1' : ''}`),
  simulateScenario: (id: string, params: ClimateScenarioParams) =>
    apiFetch<{ simulation: ClimateScenarioResult }>(`/api/farms/${id}/scenario`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  // Chat
  getChatHistory: (farmId: string) => apiFetch<{ messages: any[] }>(`/api/farms/${farmId}/chat`),
  sendChatMessage: (farmId: string, message: string) =>
    apiFetch<{ userMessage: any; assistantMessage: any }>(`/api/farms/${farmId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  clearChatHistory: (farmId: string) => apiFetch<{ ok: boolean }>(`/api/farms/${farmId}/chat`, { method: 'DELETE' }),

  // Crops
  listCrops: () => apiFetch<{ crops: Crop[] }>('/api/crops'),
  createCrop: (payload: Partial<Crop>) =>
    apiFetch<{ crop: Crop }>('/api/crops', { method: 'POST', body: JSON.stringify(payload) }),
  updateCrop: (id: string, payload: Partial<Crop>) =>
    apiFetch<{ crop: Crop }>(`/api/crops/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCrop: (id: string) => apiFetch<{ ok: boolean }>(`/api/crops/${id}`, { method: 'DELETE' }),

  // Admin
  adminOverview: () => apiFetch<any>('/api/admin/overview'),
  adminUpdateUser: (id: string, payload: { role?: string; verified?: boolean; active?: boolean }) =>
    apiFetch<{ ok: boolean }>(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminUpdateDataset: (id: string, payload: { enabled?: boolean; limitations?: string; processingMethod?: string }) =>
    apiFetch<{ ok: boolean }>(`/api/admin/datasets/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  adminUpdateAiSettings: (payload: { modelName: string; systemTone: string; strictScientificDisclaimer: boolean; maxHistoryTurns: number }) =>
    apiFetch<{ ok: boolean }>('/api/admin/ai-settings', { method: 'PUT', body: JSON.stringify(payload) }),
  adminCreateAnnouncement: (payload: { title: string; body: string; severity: string }) =>
    apiFetch<{ ok: boolean }>('/api/admin/announcements', { method: 'POST', body: JSON.stringify(payload) }),
  adminDeleteAnnouncement: (id: string) => apiFetch<{ ok: boolean }>(`/api/admin/announcements/${id}`, { method: 'DELETE' }),
  adminClearCache: () => apiFetch<{ ok: boolean }>('/api/admin/cache/clear', { method: 'POST' }),

  // Supabase Edge Function
  edgeStatus: () =>
    apiFetch<{
      configured: boolean;
      functionSlug: string;
      mode: 'supabase-remote' | 'local-edge-bridge';
      endpoint: string;
      supportedActions: string[];
    }>('/api/edge/status'),

  invokeEdge: async (
    action: 'health' | 'nasa-telemetry' | 'rotation-brief' | 'ai-advisor',
    payload: Record<string, unknown> = {},
    farmId?: string
  ) => {
    const supabase = getSupabaseClient();
    if (isSupabaseClientConfigured && supabase) {
      const { data, error } = await supabase.functions.invoke(SUPABASE_EDGE_FUNCTION_SLUG, {
        body: { action, payload: { ...payload, ...(farmId ? { farmId } : {}) } },
      });
      if (!error && data && (data as any).ok !== false) {
        return data as {
          ok: boolean;
          action: string;
          functionSlug: string;
          runtime: string;
          executedAt: string;
          data: Record<string, any>;
        };
      }
    }
    return apiFetch<{
      ok: boolean;
      action: string;
      functionSlug: string;
      runtime: string;
      executedAt: string;
      data: Record<string, any>;
    }>('/api/edge/invoke', {
      method: 'POST',
      body: JSON.stringify({ action, payload, farmId }),
    });
  },
};

export async function downloadFarmCsv(farm: Farm) {
  const token = getStoredToken();
  const res = await fetch(`/api/farms/${farm.id}/export/csv`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => null);

  let blob: Blob;
  if (res && res.ok && (res.headers.get('content-type') || '').includes('text/csv')) {
    blob = await res.blob();
  } else {
    const rows = [
      'SECTION,KEY,VALUE,NOTES',
      `Farm,"Name","${farm.name}","${farm.district}, ${farm.region}, ${farm.country}"`,
      `Farm,"Coordinates","${farm.centroidLat}, ${farm.centroidLon}","${farm.sizeHectares} ha | ${farm.farmingType}"`,
      `Farm,"Soil Profile","${farm.soilType} (${farm.soilTexture})","pH=${farm.soilPh ?? 'Unknown'}, OM=${farm.organicMatterPct ?? 'Unknown'}%"`,
    ];
    blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${farm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-farmnova-report.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function generateFarmPdfReport(farm: Farm, analysis: EnvironmentalAnalysis, strategies: RotationStrategy[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 44;
  const maxWidth = pageWidth - margin * 2;
  let y = 48;

  const ensureSpace = (needed: number) => {
    if (y + needed > 775) {
      doc.addPage();
      y = 48;
    }
  };

  const addHeading = (text: string) => {
    ensureSpace(34);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(14, 77, 58);
    doc.text(text, margin, y);
    y += 8;
    doc.setDrawColor(210, 204, 190);
    doc.line(margin, y, pageWidth - margin, y);
    y += 16;
  };

  const addBody = (text: string, size = 9.5, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(30, 42, 34);
    const lines = doc.splitTextToSize(text, maxWidth);
    ensureSpace(lines.length * (size + 3) + 6);
    doc.text(lines, margin, y);
    y += lines.length * (size + 3) + 6;
  };

  // Header Banner
  doc.setFillColor(14, 77, 58);
  doc.rect(0, 0, pageWidth, 84, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(250, 248, 243);
  doc.text('FarmNova AI Agricultural Intelligence Report', margin, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(228, 210, 165);
  doc.text(`Farm: ${farm.name} | ${farm.district}, ${farm.region}, ${farm.country} | Generated ${new Date().toISOString().slice(0, 10)}`, margin, 58);
  y = 110;

  addHeading('1. Registered Farm Profile & Soil Context');
  addBody(
    `Size: ${farm.sizeHectares} ha | Type: ${farm.farmingType} | Coordinates: ${farm.centroidLat.toFixed(4)}, ${farm.centroidLon.toFixed(4)} | SRTM Elevation: ${analysis.elevationMeters ?? 'N/A'} m | Estimated Slope: ${analysis.terrainSlopePct ?? 'N/A'}%`
  );
  addBody(
    `Soil: ${farm.soilType} (${farm.soilTexture}), Drainage: ${farm.drainage}, Fertility: ${farm.soilFertility}, pH: ${farm.soilPh ?? 'Unknown (lab test recommended)'}, Organic Matter: ${farm.organicMatterPct !== null ? `${farm.organicMatterPct}%` : 'Unknown'}, Irrigation: ${farm.irrigationAvailable}`
  );
  addBody(
    `Crop History — Previous: ${farm.previousCrops.join(', ') || 'None'} | Current: ${farm.currentCrops.join(', ') || 'None'} | Planned: ${farm.plannedCrops.join(', ') || 'None'} | Pest Notes: ${farm.pestHistory || 'None reported'}`
  );
  addBody(`Farmer Priorities: ${farm.priorities.join(', ') || 'General resilience'}`);

  addHeading('2. NASA Earth Observation Summary & Environmental Indicators');
  addBody(
    `Observation Window: ${analysis.periodSummary.startDate} to ${analysis.periodSummary.endDate} | Total Rainfall: ${analysis.periodSummary.totalRainMm ?? 'N/A'} mm | Longest Dry Spell: ${analysis.periodSummary.longestDrySpellDays} days | Heavy Rain Days (>=30mm): ${analysis.periodSummary.extremeRainDaysAbove30Mm}`
  );
  addBody(
    `Mean 2m Temperature: ${analysis.periodSummary.avgTempC ?? 'N/A'} °C | Max Observed: ${analysis.periodSummary.maxTempObservedC ?? 'N/A'} °C | Heat-Stress Days (>=35°C): ${analysis.periodSummary.heatStressDaysAbove35C}`
  );
  addBody(
    `Assimilated Root-Zone Wetness: ${analysis.periodSummary.avgRootSoilWetness ?? 'N/A'} (${analysis.periodSummary.soilMoistureAnomalyPct !== null ? `${analysis.periodSummary.soilMoistureAnomalyPct}% vs 5-yr baseline` : 'N/A'}) | Estimated Reference ET0: ${analysis.periodSummary.estimatedAnnualEt0Mm ?? 'N/A'} mm`
  );

  addHeading('3. Crop Rotation Strategies Comparison');
  for (const s of strategies) {
    addBody(`${s.label}: ${s.title} (${s.subtitle})`, 10.5, true);
    addBody(`Sequence: ${s.steps.map((st) => `${st.seasonLabel}: ${st.cropName} [${st.durationDays}]`).join(' -> ')}`);
    addBody(`Soil Health & Nutrients: ${s.soilHealthBenefits} ${s.nutrientCycling}`);
    addBody(`Water & Erosion: ${s.waterRequirements} ${s.erosionReduction}`);
    addBody(`Risks: ${s.environmentalRisks.join(' ')}`);
    addBody(`Local Validation Required: ${s.requiredLocalValidation.join(' ')}`);
    y += 4;
  }

  addHeading('4. NASA Data Sources, Scientific Limitations & Expert Review');
  for (const ds of analysis.datasets.filter((d) => d.enabled)) {
    addBody(`${ds.missionCode} (${ds.datasetName}) — Res: ${ds.spatialResolution} | Quality: ${ds.dataQuality} | Missing Obs: ${ds.missingObservations}. Limitation: ${ds.limitations}`, 8.5);
  }
  addBody(
    'Scientific Disclaimer: Coarse-resolution satellite and gridded meteorological products complement local farmer experience and extension advice; they do not replace laboratory soil testing or field-level scouting.',
    9,
    true
  );

  doc.save(`${farm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-farmnova-report.pdf`);
}
