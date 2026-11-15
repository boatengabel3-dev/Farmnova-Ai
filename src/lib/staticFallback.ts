import { getSupabaseClient, isSupabaseClientConfigured, SUPABASE_EDGE_FUNCTION_SLUG } from './supabase';
import {
  buildStaticStrategiesAndSimulation,
  evaluateStaticHazards,
  fetchStaticEnvironmentalAnalysis,
  fetchStaticRealtimeForecast,
} from './staticAnalysis';
import {
  STATIC_ANNOUNCEMENTS,
  STATIC_CROPS,
  STATIC_DATASETS,
  STATIC_DEMO_FARMS,
  STATIC_DEMO_USERS,
  type StaticUserRecord,
} from './staticSeed';
import type { Announcement, ChatMessage, ClimateScenarioParams, Crop, Farm, User } from '../types';

const STORAGE_KEYS = {
  users: 'farmnova_static_users_v1',
  sessions: 'farmnova_static_sessions_v1',
  farms: 'farmnova_static_farms_v1',
  crops: 'farmnova_static_crops_v1',
  announcements: 'farmnova_static_announcements_v1',
  chats: 'farmnova_static_chats_v1',
  aiSettings: 'farmnova_static_ai_settings_v1',
};

const analysisMemoryCache = new Map<string, Awaited<ReturnType<typeof fetchStaticEnvironmentalAnalysis>>['analysis']>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

function getUsers(): StaticUserRecord[] {
  const stored = readJson<StaticUserRecord[] | null>(STORAGE_KEYS.users, null);
  if (!stored || stored.length === 0) {
    writeJson(STORAGE_KEYS.users, STATIC_DEMO_USERS);
    return STATIC_DEMO_USERS;
  }
  // Ensure demo users always stay available
  const missingDemos = STATIC_DEMO_USERS.filter((d) => !stored.some((u) => u.email === d.email));
  if (missingDemos.length > 0) {
    const merged = [...stored, ...missingDemos];
    writeJson(STORAGE_KEYS.users, merged);
    return merged;
  }
  return stored;
}

function toPublicUser(u: StaticUserRecord): User {
  const { password: _p, active: _a, verificationToken: _v, ...rest } = u;
  return rest;
}

function getSessions(): Record<string, string> {
  return readJson<Record<string, string>>(STORAGE_KEYS.sessions, {});
}

function issueToken(userId: string): string {
  const token = `static_${userId}_${Math.random().toString(36).slice(2, 12)}`;
  const sessions = getSessions();
  sessions[token] = userId;
  writeJson(STORAGE_KEYS.sessions, sessions);
  return token;
}

function getCurrentUser(headers?: Record<string, string>): StaticUserRecord | null {
  const auth = headers?.Authorization || headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : localStorage.getItem('farmnova_session_token') || '';
  if (!token) return null;
  const sessions = getSessions();
  const uid = sessions[token];
  if (!uid) return null;
  return getUsers().find((u) => u.id === uid && u.active !== false) ?? null;
}

function getFarms(): Farm[] {
  const stored = readJson<Farm[] | null>(STORAGE_KEYS.farms, null);
  if (!stored) {
    writeJson(STORAGE_KEYS.farms, STATIC_DEMO_FARMS);
    return STATIC_DEMO_FARMS;
  }
  return stored;
}

function getCrops(): Crop[] {
  const stored = readJson<Crop[] | null>(STORAGE_KEYS.crops, null);
  if (!stored || stored.length === 0) {
    writeJson(STORAGE_KEYS.crops, STATIC_CROPS);
    return STATIC_CROPS;
  }
  return stored;
}

function getAnnouncements(): Announcement[] {
  const stored = readJson<Announcement[] | null>(STORAGE_KEYS.announcements, null);
  if (!stored) {
    writeJson(STORAGE_KEYS.announcements, STATIC_ANNOUNCEMENTS);
    return STATIC_ANNOUNCEMENTS;
  }
  return stored;
}

function requireStaticUser(headers?: Record<string, string>): StaticUserRecord {
  const user = getCurrentUser(headers);
  if (!user) {
    throw new Error('Authentication required. Please sign in again.');
  }
  return user;
}

function requireStaticFarm(farmId: string, userId: string): Farm {
  const farm = getFarms().find((f) => f.id === farmId);
  if (!farm) throw new Error('Farm not found.');
  if (farm.ownerId !== userId) {
    throw new Error('Access denied. You do not have permission to view another farmer’s private farm records.');
  }
  return farm;
}

export async function handleStaticApiFallback<T>(
  path: string,
  options: RequestInit = {},
  headers: Record<string, string> = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const url = new URL(path, 'https://farmnova.local');
  const pathname = url.pathname;
  const body = options.body && typeof options.body === 'string' ? JSON.parse(options.body) : {};

  // ---------------- AUTH ----------------
  if (pathname === '/api/auth/login' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) throw new Error('Email and password are required.');

    const users = getUsers();
    const localMatch = users.find((u) => u.email === email && u.password === password);
    if (localMatch) {
      if (!localMatch.active) throw new Error('This account has been deactivated by an administrator.');
      const token = issueToken(localMatch.id);
      return { token, user: toPublicUser(localMatch) } as T;
    }

    // Optional live Supabase Auth login if configured on static host
    const supabase = getSupabaseClient();
    if (isSupabaseClientConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (!error && data.user) {
        const syncedUser: StaticUserRecord = {
          id: data.user.id,
          email: data.user.email || email,
          name: String(data.user.user_metadata?.name || email.split('@')[0]),
          password,
          role: 'farmer',
          verified: Boolean(data.user.email_confirmed_at),
          organization: String(data.user.user_metadata?.organization || ''),
          region: String(data.user.user_metadata?.region || ''),
          preferredUnits: 'metric',
          active: true,
          createdAt: data.user.created_at || new Date().toISOString(),
        };
        const updated = [...users.filter((u) => u.email !== email), syncedUser];
        writeJson(STORAGE_KEYS.users, updated);
        const token = issueToken(syncedUser.id);
        return { token, user: toPublicUser(syncedUser) } as T;
      }
      if (error) {
        throw new Error(error.message || 'Invalid email or password.');
      }
    }

    throw new Error('Invalid email or password.');
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || '').trim();
    if (!email || !password || !name) throw new Error('Name, email, and password are required.');
    if (password.length < 8) throw new Error('Password must be at least 8 characters.');

    const users = getUsers();
    if (users.some((u) => u.email === email)) {
      throw new Error('An account with this email already exists.');
    }

    let userId = `farmer-${Math.random().toString(36).slice(2, 10)}`;
    const verificationToken = Math.random().toString(36).slice(2, 10).toUpperCase();

    // If Supabase client is configured, also register user in Supabase Auth (farmer role)
    const supabase = getSupabaseClient();
    if (isSupabaseClientConfigured && supabase) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, role: 'farmer', organization: body.organization || '', region: body.region || '' } },
      });
      if (error) {
        throw new Error(error.message || 'Registration failed.');
      }
      if (data.user?.id) userId = data.user.id;
    }

    const newUser: StaticUserRecord = {
      id: userId,
      email,
      name,
      password,
      role: 'farmer', // strictly farmer-only self registration
      verified: false,
      verificationToken,
      organization: String(body.organization || ''),
      region: String(body.region || ''),
      preferredUnits: 'metric',
      active: true,
      createdAt: new Date().toISOString(),
    };
    writeJson(STORAGE_KEYS.users, [...users, newUser]);
    const token = issueToken(newUser.id);
    return {
      token,
      user: toPublicUser(newUser),
      verificationToken,
      message: 'Farmer account created. Complete email verification using the issued verification code.',
    } as T;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const user = requireStaticUser(headers);
    return { user: toPublicUser(user) } as T;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const auth = headers?.Authorization || headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) {
      const sessions = getSessions();
      delete sessions[token];
      writeJson(STORAGE_KEYS.sessions, sessions);
    }
    return { ok: true } as T;
  }

  if (pathname === '/api/auth/verify-email' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const token = String(body.token || '').trim();
    const users = getUsers();
    const idx = users.findIndex((u) => u.email === email);
    if (idx === -1) throw new Error('Account not found.');
    if (!users[idx].verified && users[idx].verificationToken && users[idx].verificationToken !== token) {
      throw new Error('Invalid verification code.');
    }
    users[idx] = { ...users[idx], verified: true, verificationToken: undefined };
    writeJson(STORAGE_KEYS.users, users);
    return { verified: true, user: toPublicUser(users[idx]) } as T;
  }

  if (pathname === '/api/auth/resend-verification' && method === 'POST') {
    const user = requireStaticUser(headers);
    const verificationToken = Math.random().toString(36).slice(2, 10).toUpperCase();
    const users = getUsers().map((u) => (u.id === user.id ? { ...u, verificationToken } : u));
    writeJson(STORAGE_KEYS.users, users);
    return { verificationToken, message: 'New email verification code generated.' } as T;
  }

  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    return {
      message: 'Password recovery token issued (valid for 1 hour).',
      demoRecoveryToken: 'FARM-RECOVER-2026',
    } as T;
  }

  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const email = String(body.email || '').trim().toLowerCase();
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
    const users = getUsers().map((u) => (u.email === email ? { ...u, password: newPassword } : u));
    writeJson(STORAGE_KEYS.users, users);
    return { ok: true, message: 'Password updated successfully. Please sign in.' } as T;
  }

  if (pathname === '/api/auth/profile' && method === 'PUT') {
    const user = requireStaticUser(headers);
    const users = getUsers();
    const idx = users.findIndex((u) => u.id === user.id);
    users[idx] = {
      ...users[idx],
      name: String(body.name ?? users[idx].name),
      organization: String(body.organization ?? users[idx].organization),
      region: String(body.region ?? users[idx].region),
      preferredUnits: body.preferredUnits === 'imperial' ? 'imperial' : 'metric',
    };
    writeJson(STORAGE_KEYS.users, users);
    return { user: toPublicUser(users[idx]) } as T;
  }

  // ---------------- ANNOUNCEMENTS & CROPS ----------------
  if (pathname === '/api/announcements' && method === 'GET') {
    return { announcements: getAnnouncements().filter((a) => a.active) } as T;
  }

  if (pathname === '/api/crops' && method === 'GET') {
    requireStaticUser(headers);
    return { crops: getCrops() } as T;
  }

  if (pathname === '/api/crops' && method === 'POST') {
    const user = requireStaticUser(headers);
    const newCrop: Crop = {
      id: String(body.id || body.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      name: String(body.name),
      scientificName: String(body.scientificName),
      family: String(body.family),
      growingDurationDays: String(body.growingDurationDays || '90–120 days'),
      waterReqMm: String(body.waterReqMm || '400–600 mm'),
      waterTier: body.waterTier || 'Moderate',
      tempMinC: Number(body.tempMinC ?? 14),
      tempOptMinC: Number(body.tempOptMinC ?? 22),
      tempOptMaxC: Number(body.tempOptMaxC ?? 32),
      tempMaxC: Number(body.tempMaxC ?? 38),
      soilPreference: String(body.soilPreference || 'Well-drained loam'),
      phMin: Number(body.phMin ?? 5.5),
      phMax: Number(body.phMax ?? 7.2),
      rootingDepthCm: String(body.rootingDepthCm || '60–120 cm'),
      rootingType: String(body.rootingType || 'Taproot/fibrous'),
      nutrientDemand: body.nutrientDemand || 'Moderate',
      nitrogenFixingKgHa: Number(body.nitrogenFixingKgHa ?? 0),
      organicMatterContrib: body.organicMatterContrib || 'Moderate',
      foragePotential: String(body.foragePotential || 'Moderate crop residue'),
      pestDiseaseNotes: String(body.pestDiseaseNotes || 'Monitor local pests.'),
      suitableSeasons: String(body.suitableSeasons || 'Main rainy season'),
      compatiblePredecessors: Array.isArray(body.compatiblePredecessors) ? body.compatiblePredecessors : [],
      incompatiblePredecessors: Array.isArray(body.incompatiblePredecessors) ? body.incompatiblePredecessors : [],
      regions: Array.isArray(body.regions) ? body.regions : ['Global'],
      updatedBy: user.email,
      updatedAt: new Date().toISOString(),
    };
    const next = [...getCrops(), newCrop];
    writeJson(STORAGE_KEYS.crops, next);
    return { crop: newCrop } as T;
  }

  // ---------------- FARMS CRUD ----------------
  if (pathname === '/api/farms' && method === 'GET') {
    const user = requireStaticUser(headers);
    const farms = getFarms().filter((f) => f.ownerId === user.id);
    return { farms } as T;
  }

  if (pathname === '/api/farms' && method === 'POST') {
    const user = requireStaticUser(headers);
    const now = new Date().toISOString();
    const newFarm: Farm = {
      id: `farm-${Math.random().toString(36).slice(2, 10)}`,
      ownerId: user.id,
      ownerName: user.name,
      name: String(body.name || 'My Farm'),
      country: String(body.country || 'Unknown'),
      region: String(body.region || 'Unknown'),
      district: String(body.district || ''),
      sizeHectares: Number(body.sizeHectares || 1),
      farmingType: String(body.farmingType || 'Mixed rainfed smallholder'),
      centroidLat: Number(body.centroidLat),
      centroidLon: Number(body.centroidLon),
      polygonCoords: Array.isArray(body.polygonCoords) ? body.polygonCoords : [],
      soilType: String(body.soilType || 'Unknown'),
      soilTexture: String(body.soilTexture || 'Unknown'),
      drainage: String(body.drainage || 'Unknown'),
      soilFertility: String(body.soilFertility || 'Unknown'),
      organicMatterPct: body.organicMatterPct !== '' && body.organicMatterPct !== undefined && body.organicMatterPct !== null ? Number(body.organicMatterPct) : null,
      soilPh: body.soilPh !== '' && body.soilPh !== undefined && body.soilPh !== null ? Number(body.soilPh) : null,
      irrigationAvailable: String(body.irrigationAvailable || 'None (rainfed)'),
      soilNotes: String(body.soilNotes || ''),
      previousCrops: Array.isArray(body.previousCrops) ? body.previousCrops : [],
      currentCrops: Array.isArray(body.currentCrops) ? body.currentCrops : [],
      plannedCrops: Array.isArray(body.plannedCrops) ? body.plannedCrops : [],
      plantingSeasons: String(body.plantingSeasons || 'Main rainy season'),
      harvestPeriods: String(body.harvestPeriods || 'End of rainy season'),
      pestHistory: String(body.pestHistory || ''),
      availableWater: String(body.availableWater || 'Rainfed'),
      equipmentNotes: String(body.equipmentNotes || ''),
      marketPreferences: String(body.marketPreferences || ''),
      priorities: Array.isArray(body.priorities) ? body.priorities : [],
      createdAt: now,
      updatedAt: now,
    };
    writeJson(STORAGE_KEYS.farms, [newFarm, ...getFarms()]);
    return { farm: newFarm } as T;
  }

  const farmUpdateMatch = pathname.match(/^\/api\/farms\/([^/]+)$/);
  if (farmUpdateMatch && method === 'PUT') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(farmUpdateMatch[1], user.id);
    const updated: Farm = {
      ...farm,
      ...body,
      id: farm.id,
      ownerId: farm.ownerId,
      updatedAt: new Date().toISOString(),
    };
    const next = getFarms().map((f) => (f.id === farm.id ? updated : f));
    writeJson(STORAGE_KEYS.farms, next);
    return { farm: updated } as T;
  }

  if (farmUpdateMatch && method === 'DELETE') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(farmUpdateMatch[1], user.id);
    writeJson(
      STORAGE_KEYS.farms,
      getFarms().filter((f) => f.id !== farm.id)
    );
    return { ok: true } as T;
  }

  // ---------------- ANALYSIS, FORECAST, SCENARIO, CHAT ----------------
  const analysisMatch = pathname.match(/^\/api\/farms\/([^/]+)\/analysis$/);
  if (analysisMatch && method === 'GET') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(analysisMatch[1], user.id);
    const forceRefresh = url.searchParams.get('refresh') === '1';
    const cacheKey = `${farm.id}_${farm.centroidLat.toFixed(3)}_${farm.centroidLon.toFixed(3)}`;
    let analysis = !forceRefresh ? analysisMemoryCache.get(cacheKey) : undefined;
    if (!analysis) {
      const res = await fetchStaticEnvironmentalAnalysis(farm);
      analysis = res.analysis;
      analysisMemoryCache.set(cacheKey, analysis);
    } else {
      analysis = { ...analysis, cacheHit: true };
    }
    const { strategies } = buildStaticStrategiesAndSimulation(farm, analysis, getCrops());
    return { farm, analysis, strategies } as T;
  }

  const forecastMatch = pathname.match(/^\/api\/farms\/([^/]+)\/forecast$/);
  if (forecastMatch && method === 'GET') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(forecastMatch[1], user.id);
    const realtimeForecast = await fetchStaticRealtimeForecast(farm.centroidLat, farm.centroidLon);
    const cacheKey = `${farm.id}_${farm.centroidLat.toFixed(3)}_${farm.centroidLon.toFixed(3)}`;
    let analysis = analysisMemoryCache.get(cacheKey);
    if (!analysis) {
      analysis = (await fetchStaticEnvironmentalAnalysis(farm)).analysis;
      analysisMemoryCache.set(cacheKey, analysis);
    }
    const hazards = evaluateStaticHazards(farm, analysis, realtimeForecast);
    return { realtimeForecast, hazards } as T;
  }

  const scenarioMatch = pathname.match(/^\/api\/farms\/([^/]+)\/scenario$/);
  if (scenarioMatch && method === 'POST') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(scenarioMatch[1], user.id);
    const cacheKey = `${farm.id}_${farm.centroidLat.toFixed(3)}_${farm.centroidLon.toFixed(3)}`;
    let analysis = analysisMemoryCache.get(cacheKey);
    if (!analysis) {
      analysis = (await fetchStaticEnvironmentalAnalysis(farm)).analysis;
      analysisMemoryCache.set(cacheKey, analysis);
    }
    const { simulation } = buildStaticStrategiesAndSimulation(
      farm,
      analysis,
      getCrops(),
      body as ClimateScenarioParams
    );
    return { simulation } as T;
  }

  const chatMatch = pathname.match(/^\/api\/farms\/([^/]+)\/chat$/);
  if (chatMatch && method === 'GET') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(chatMatch[1], user.id);
    const allChats = readJson<Record<string, ChatMessage[]>>(STORAGE_KEYS.chats, {});
    return { messages: allChats[`${user.id}_${farm.id}`] || [] } as T;
  }

  if (chatMatch && method === 'POST') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(chatMatch[1], user.id);
    const message = String(body.message || '').trim();
    if (!message) throw new Error('Question cannot be empty.');
    const cacheKey = `${farm.id}_${farm.centroidLat.toFixed(3)}_${farm.centroidLon.toFixed(3)}`;
    const analysis =
      analysisMemoryCache.get(cacheKey) || (await fetchStaticEnvironmentalAnalysis(farm)).analysis;
    analysisMemoryCache.set(cacheKey, analysis);
    const { strategies } = buildStaticStrategiesAndSimulation(farm, analysis, getCrops());

    let answer = '';
    const supabase = getSupabaseClient();
    if (isSupabaseClientConfigured && supabase) {
      try {
        const { data, error } = await supabase.functions.invoke(SUPABASE_EDGE_FUNCTION_SLUG, {
          body: {
            action: 'ai-advisor',
            payload: {
              question: message,
              contextSummary: `Farm: ${farm.name} (${farm.region}, ${farm.country}), Rain: ${analysis.periodSummary.totalRainMm} mm, Root Wetness: ${analysis.periodSummary.avgRootSoilWetness}`,
            },
          },
        });
        if (!error && (data as any)?.data?.answer) {
          answer = String((data as any).data.answer);
        }
      } catch {
        // fallback below
      }
    }

    if (!answer) {
      answer = [
        `Agronomic Summary for ${farm.name} (${farm.region}, ${farm.country}):`,
        `• NASA POWER Rainfall: ${analysis.periodSummary.totalRainMm ?? 'N/A'} mm (longest dry spell: ${analysis.periodSummary.longestDrySpellDays} days).`,
        `• Root-Zone Soil Wetness: ${analysis.periodSummary.avgRootSoilWetness !== null ? `${(analysis.periodSummary.avgRootSoilWetness * 100).toFixed(0)}%` : 'N/A'}.`,
        `• Recommended Rotation Paths: ${strategies.map((s) => `${s.label} (${s.title})`).join('; ')}.`,
        farm.soilPh === null
          ? '• Missing Field Check: Soil pH has not been tested locally—confirm topsoil pH and moisture before applying lime or basal fertilizer.'
          : `• Recorded Soil pH: ${farm.soilPh} (${farm.soilTexture}). Confirm field drainage before sowing.`,
      ].join('\n');
    }

    const now1 = new Date().toISOString();
    const now2 = new Date(Date.now() + 10).toISOString();
    const userMsg: ChatMessage = { id: `m_${Date.now()}_u`, farmId: farm.id, role: 'user', content: message, createdAt: now1 };
    const asstMsg: ChatMessage = { id: `m_${Date.now()}_a`, farmId: farm.id, role: 'assistant', content: answer, createdAt: now2 };

    const allChats = readJson<Record<string, ChatMessage[]>>(STORAGE_KEYS.chats, {});
    const chatKey = `${user.id}_${farm.id}`;
    allChats[chatKey] = [...(allChats[chatKey] || []), userMsg, asstMsg];
    writeJson(STORAGE_KEYS.chats, allChats);
    return { userMessage: userMsg, assistantMessage: asstMsg } as T;
  }

  if (chatMatch && method === 'DELETE') {
    const user = requireStaticUser(headers);
    const farm = requireStaticFarm(chatMatch[1], user.id);
    const allChats = readJson<Record<string, ChatMessage[]>>(STORAGE_KEYS.chats, {});
    delete allChats[`${user.id}_${farm.id}`];
    writeJson(STORAGE_KEYS.chats, allChats);
    return { ok: true } as T;
  }

  // ---------------- EDGE & ADMIN ----------------
  if (pathname === '/api/edge/status' && method === 'GET') {
    const configured = isSupabaseClientConfigured;
    return {
      configured,
      functionSlug: SUPABASE_EDGE_FUNCTION_SLUG,
      mode: configured ? 'supabase-remote' : 'local-edge-bridge',
      endpoint: configured
        ? `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')}/functions/v1/${SUPABASE_EDGE_FUNCTION_SLUG}`
        : `client-edge-bridge (${SUPABASE_EDGE_FUNCTION_SLUG})`,
      supportedActions: ['health', 'nasa-telemetry', 'rotation-brief', 'ai-advisor'],
    } as T;
  }

  if (pathname === '/api/edge/invoke' && method === 'POST') {
    const action = String(body.action || 'health');
    return {
      ok: true,
      action,
      functionSlug: SUPABASE_EDGE_FUNCTION_SLUG,
      runtime: 'local-edge-bridge',
      executedAt: new Date().toISOString(),
      data: {
        status: 'healthy',
        mode: 'client-edge-bridge',
        note: 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to invoke your hosted Supabase Edge Function.',
      },
    } as T;
  }

  if (pathname === '/api/admin/overview' && method === 'GET') {
    requireStaticUser(headers);
    const users = getUsers().map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      verified: u.verified ? 1 : 0,
      organization: u.organization,
      region: u.region,
      active: u.active ? 1 : 0,
      created_at: u.createdAt,
    }));
    const farms = getFarms().map((f) => ({
      id: f.id,
      name: f.name,
      country: f.country,
      region: f.region,
      district: f.district,
      size_hectares: f.sizeHectares,
      farming_type: f.farmingType,
      centroid_lat: f.centroidLat,
      centroid_lon: f.centroidLon,
    }));
    const aiSettings = readJson(STORAGE_KEYS.aiSettings, {
      model_name: 'gemini-4-hydrogen',
      system_tone: 'Practical, respectful agronomic advisor grounded in empirical observation',
      strict_scientific_disclaimer: 1,
      max_history_turns: 12,
    });
    return {
      health: {
        database: isSupabaseClientConfigured ? 'Supabase Client + Browser Cache' : 'Static Browser Storage + Live NASA/Weather APIs',
        nasaPowerEndpoint: 'https://power.larc.nasa.gov/api',
        cachedGeospatialQueries: analysisMemoryCache.size,
        totalChatInteractions: 0,
        cropCatalogCount: getCrops().length,
        uptimeSeconds: Math.round(performance.now() / 1000),
      },
      users,
      farms,
      datasets: STATIC_DATASETS.map((d) => ({
        id: d.id,
        dataset_name: d.datasetName,
        mission_code: d.missionCode,
        spatial_resolution: d.spatialResolution,
        temporal_resolution: d.temporalResolution,
        limitations: d.limitations,
        enabled: d.enabled ? 1 : 0,
      })),
      aiSettings,
      announcements: getAnnouncements(),
      auditLogs: [],
    } as T;
  }

  throw new Error(`Endpoint unavailable in static mode: ${pathname}`);
}
