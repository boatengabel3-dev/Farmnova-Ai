import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { db, generateToken, hashPassword, initDatabase, verifyPassword, writeAuditLog } from './server/db.ts';
import { fetchFarmEnvironmentalAnalysis } from './server/nasa.ts';
import { generateRotationStrategies, simulateClimateScenarios } from './server/rotationEngine.ts';
import { askAgriAssistant } from './server/aiAssistant.ts';
import type { ClimateScenarioParams, Crop, Farm, GeoPoint, User, UserRole } from './src/types.ts';

initDatabase();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

// Simple sliding-window API rate limiter
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimiter(maxPerMin: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.path.split('/').slice(0, 3).join('/')}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (bucket.count >= maxPerMin) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    bucket.count += 1;
    next();
  };
}
app.use('/api', rateLimiter(180));

interface AuthedRequest extends Request {
  user?: User;
  token?: string;
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as UserRole,
    verified: Boolean(row.verified),
    organization: row.organization || '',
    region: row.region || '',
    preferredUnits: (row.preferred_units as 'metric' | 'imperial') || 'metric',
    createdAt: row.created_at,
  };
}

function rowToFarm(row: any): Farm {
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
    polygonCoords: JSON.parse(row.polygon_geojson || '[]') as GeoPoint[],
    soilType: row.soil_type,
    soilTexture: row.soil_texture,
    drainage: row.drainage,
    soilFertility: row.soil_fertility,
    organicMatterPct: row.organic_matter_pct !== null && row.organic_matter_pct !== undefined ? Number(row.organic_matter_pct) : null,
    soilPh: row.soil_ph !== null && row.soil_ph !== undefined ? Number(row.soil_ph) : null,
    irrigationAvailable: row.irrigation_available,
    soilNotes: row.soil_notes || '',
    previousCrops: JSON.parse(row.previous_crops_json || '[]'),
    currentCrops: JSON.parse(row.current_crops_json || '[]'),
    plannedCrops: JSON.parse(row.planned_crops_json || '[]'),
    plantingSeasons: row.planting_seasons,
    harvestPeriods: row.harvest_periods,
    pestHistory: row.pest_history || '',
    availableWater: row.available_water,
    equipmentNotes: row.equipment_notes || '',
    marketPreferences: row.market_preferences || '',
    priorities: JSON.parse(row.priorities_json || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCrop(row: any): Crop {
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
    compatiblePredecessors: JSON.parse(row.compatible_predecessors_json || '[]'),
    incompatiblePredecessors: JSON.parse(row.incompatible_predecessors_json || '[]'),
    regions: JSON.parse(row.regions_json || '[]'),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  const session = db
    .prepare(
      `SELECT s.token, s.expires_at, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND u.active = 1`
    )
    .get(token) as any;

  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
  req.user = rowToUser(session);
  req.token = token;
  next();
}

function requireRoles(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access restricted. Required role: ${roles.join(' or ')}.` });
    }
    next();
  };
}

/**
 * Strict farm ownership isolation:
 * Farmers, Experts, and Researchers can ONLY read/modify farms they own.
 * Even Admins cannot bypass private farm isolation unless explicitly querying aggregated admin telemetry.
 */
function loadOwnedFarm(req: AuthedRequest, res: Response): Farm | null {
  const farmId = req.params.id;
  const row = db
    .prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`)
    .get(farmId) as any;
  if (!row) {
    res.status(404).json({ error: 'Farm not found.' });
    return null;
  }
  if (row.owner_id !== req.user!.id) {
    writeAuditLog(req.user!.id, req.user!.email, 'UNAUTHORIZED_FARM_ACCESS_ATTEMPT', 'farm', farmId, 'Blocked cross-user farm access', req.ip);
    res.status(403).json({ error: 'Access denied. You do not have permission to view or modify another farmer’s private farm records.' });
    return null;
  }
  return rowToFarm(row);
}

// ---------------- AUTHENTICATION ROUTES ----------------

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, password, name, role, organization, region } = req.body ?? {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  // Self-registration permits farmer, expert, or researcher (admin must be promoted by an existing admin)
  const allowedSelfRoles: UserRole[] = ['farmer', 'expert', 'researcher'];
  const assignedRole: UserRole = allowedSelfRoles.includes(role) ? role : 'farmer';
  const id = crypto.randomUUID();
  const verificationToken = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, verified, verification_token, organization, region, preferred_units, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'metric', ?)`
  ).run(id, normalizedEmail, String(name).trim(), hashPassword(String(password)), assignedRole, verificationToken, organization || '', region || '', now);

  const sessionToken = generateToken();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
    sessionToken,
    id,
    Date.now() + 7 * 86400 * 1000,
    now
  );

  writeAuditLog(id, normalizedEmail, 'USER_REGISTERED', 'user', id, `Role=${assignedRole}`, req.ip);

  const userRow = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  res.status(201).json({
    token: sessionToken,
    user: rowToUser(userRow),
    verificationToken,
    message: 'Account created. Complete email verification using the issued verification code.',
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail) as any;
  if (!userRow || !verifyPassword(String(password), userRow.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!userRow.active) {
    return res.status(403).json({ error: 'This account has been deactivated by an administrator.' });
  }

  const sessionToken = generateToken();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
    sessionToken,
    userRow.id,
    Date.now() + 7 * 86400 * 1000,
    new Date().toISOString()
  );

  writeAuditLog(userRow.id, normalizedEmail, 'USER_LOGIN', 'user', userRow.id, 'Authenticated session issued', req.ip);
  res.json({ token: sessionToken, user: rowToUser(userRow) });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
  if (req.token) {
    db.prepare(`DELETE FROM sessions WHERE token = ?`).run(req.token);
  }
  writeAuditLog(req.user!.id, req.user!.email, 'USER_LOGOUT', 'user', req.user!.id, 'Session terminated', req.ip);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

app.post('/api/auth/verify-email', (req: Request, res: Response) => {
  const { email, token } = req.body ?? {};
  if (!email || !token) return res.status(400).json({ error: 'Email and verification code are required.' });
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase()) as any;
  if (!userRow) return res.status(404).json({ error: 'Account not found.' });
  if (userRow.verified) return res.json({ verified: true, message: 'Email is already verified.' });
  if (userRow.verification_token !== String(token).trim()) {
    return res.status(400).json({ error: 'Invalid verification code.' });
  }
  db.prepare(`UPDATE users SET verified = 1, verification_token = NULL WHERE id = ?`).run(userRow.id);
  writeAuditLog(userRow.id, userRow.email, 'EMAIL_VERIFIED', 'user', userRow.id, 'Email verification completed', req.ip);
  res.json({ verified: true, user: rowToUser(db.prepare(`SELECT * FROM users WHERE id = ?`).get(userRow.id)) });
});

app.post('/api/auth/resend-verification', requireAuth, (req: AuthedRequest, res: Response) => {
  const verificationToken = crypto.randomBytes(16).toString('hex');
  db.prepare(`UPDATE users SET verification_token = ? WHERE id = ?`).run(verificationToken, req.user!.id);
  res.json({ verificationToken, message: 'New email verification code generated.' });
});

app.post('/api/auth/forgot-password', (req: Request, res: Response) => {
  const { email } = req.body ?? {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(normalizedEmail) as any;
  if (!userRow) {
    return res.json({ message: 'If an account matches this email, a recovery token has been issued.' });
  }
  const resetToken = crypto.randomBytes(12).toString('hex');
  const resetExpires = Date.now() + 3600 * 1000;
  db.prepare(`UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?`).run(resetToken, resetExpires, userRow.id);
  writeAuditLog(userRow.id, normalizedEmail, 'PASSWORD_RESET_REQUESTED', 'user', userRow.id, 'Recovery token generated', req.ip);
  res.json({
    message: 'Password recovery token issued (valid for 1 hour).',
    demoRecoveryToken: resetToken,
  });
});

app.post('/api/auth/reset-password', (req: Request, res: Response) => {
  const { email, token, newPassword } = req.body ?? {};
  if (!email || !token || !newPassword) {
    return res.status(400).json({ error: 'Email, recovery token, and new password are required.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const userRow = db.prepare(`SELECT * FROM users WHERE email = ?`).get(String(email).trim().toLowerCase()) as any;
  if (!userRow || userRow.reset_token !== String(token).trim() || !userRow.reset_expires || userRow.reset_expires < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired recovery token.' });
  }
  db.prepare(`UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?`).run(
    hashPassword(String(newPassword)),
    userRow.id
  );
  db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(userRow.id);
  writeAuditLog(userRow.id, userRow.email, 'PASSWORD_RESET_COMPLETED', 'user', userRow.id, 'Password updated', req.ip);
  res.json({ ok: true, message: 'Password updated successfully. Please sign in.' });
});

app.put('/api/auth/profile', requireAuth, (req: AuthedRequest, res: Response) => {
  const { name, organization, region, preferredUnits } = req.body ?? {};
  db.prepare(`UPDATE users SET name = ?, organization = ?, region = ?, preferred_units = ? WHERE id = ?`).run(
    String(name || req.user!.name).trim(),
    String(organization ?? req.user!.organization).trim(),
    String(region ?? req.user!.region).trim(),
    preferredUnits === 'imperial' ? 'imperial' : 'metric',
    req.user!.id
  );
  const updated = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id);
  writeAuditLog(req.user!.id, req.user!.email, 'PROFILE_UPDATED', 'user', req.user!.id, 'Updated user profile settings', req.ip);
  res.json({ user: rowToUser(updated) });
});

// ---------------- PUBLIC ANNOUNCEMENTS ----------------
app.get('/api/announcements', (_req: Request, res: Response) => {
  const rows = db.prepare(`SELECT * FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 5`).all() as any[];
  res.json({
    announcements: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      severity: r.severity,
      active: Boolean(r.active),
      createdBy: r.created_by,
      createdAt: r.created_at,
    })),
  });
});

// ---------------- FARM CRUD & ANALYTICS (STRICT OWNERSHIP ISOLATION) ----------------
app.get('/api/farms', requireAuth, (req: AuthedRequest, res: Response) => {
  const rows = db
    .prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.owner_id = ? ORDER BY f.updated_at DESC`)
    .all(req.user!.id) as any[];
  res.json({ farms: rows.map(rowToFarm) });
});

app.post('/api/farms', requireAuth, (req: AuthedRequest, res: Response) => {
  const body = req.body ?? {};
  if (!body.name || !body.country || !body.region || !body.centroidLat || !body.centroidLon) {
    return res.status(400).json({ error: 'Farm name, location, and geographic coordinates are required.' });
  }
  const id = `farm-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

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
    req.user!.id,
    String(body.name).trim(),
    String(body.country).trim(),
    String(body.region).trim(),
    String(body.district || '').trim(),
    Number(body.sizeHectares) || 1.0,
    String(body.farmingType || 'Mixed rainfed smallholder'),
    Number(body.centroidLat),
    Number(body.centroidLon),
    JSON.stringify(body.polygonCoords || []),
    String(body.soilType || 'Unknown'),
    String(body.soilTexture || 'Unknown'),
    String(body.drainage || 'Unknown'),
    String(body.soilFertility || 'Unknown'),
    body.organicMatterPct !== null && body.organicMatterPct !== undefined && body.organicMatterPct !== '' ? Number(body.organicMatterPct) : null,
    body.soilPh !== null && body.soilPh !== undefined && body.soilPh !== '' ? Number(body.soilPh) : null,
    String(body.irrigationAvailable || 'None (rainfed)'),
    String(body.soilNotes || ''),
    JSON.stringify(Array.isArray(body.previousCrops) ? body.previousCrops : []),
    JSON.stringify(Array.isArray(body.currentCrops) ? body.currentCrops : []),
    JSON.stringify(Array.isArray(body.plannedCrops) ? body.plannedCrops : []),
    String(body.plantingSeasons || 'Main rainy season'),
    String(body.harvestPeriods || 'End of rainy season'),
    String(body.pestHistory || ''),
    String(body.availableWater || 'Rainfed'),
    String(body.equipmentNotes || ''),
    String(body.marketPreferences || ''),
    JSON.stringify(Array.isArray(body.priorities) ? body.priorities : []),
    now,
    now
  );

  writeAuditLog(req.user!.id, req.user!.email, 'FARM_CREATED', 'farm', id, `Registered farm "${body.name}"`, req.ip);
  const created = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`).get(id);
  res.status(201).json({ farm: rowToFarm(created) });
});

app.put('/api/farms/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedFarm(req, res);
  if (!existing) return;
  const body = req.body ?? {};
  const now = new Date().toISOString();

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
    body.organicMatterPct !== undefined ? (body.organicMatterPct === null || body.organicMatterPct === '' ? null : Number(body.organicMatterPct)) : existing.organicMatterPct,
    body.soilPh !== undefined ? (body.soilPh === null || body.soilPh === '' ? null : Number(body.soilPh)) : existing.soilPh,
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
    req.user!.id
  );

  writeAuditLog(req.user!.id, req.user!.email, 'FARM_UPDATED', 'farm', existing.id, `Updated farm "${body.name ?? existing.name}"`, req.ip);
  const updated = db.prepare(`SELECT f.*, u.name as owner_name FROM farms f JOIN users u ON u.id = f.owner_id WHERE f.id = ?`).get(existing.id);
  res.json({ farm: rowToFarm(updated) });
});

app.delete('/api/farms/:id', requireAuth, (req: AuthedRequest, res: Response) => {
  const existing = loadOwnedFarm(req, res);
  if (!existing) return;
  db.prepare(`DELETE FROM farms WHERE id = ? AND owner_id = ?`).run(existing.id, req.user!.id);
  writeAuditLog(req.user!.id, req.user!.email, 'FARM_DELETED', 'farm', existing.id, `Deleted farm "${existing.name}"`, req.ip);
  res.json({ ok: true });
});

app.get('/api/farms/:id/analysis', requireAuth, async (req: AuthedRequest, res: Response) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  try {
    const forceRefresh = req.query.refresh === '1';
    const analysis = await fetchFarmEnvironmentalAnalysis(farm, forceRefresh);
    const cropRows = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all() as any[];
    const crops = cropRows.map(rowToCrop);
    const strategies = generateRotationStrategies(farm, analysis, crops);
    res.json({ farm, analysis, strategies });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to retrieve NASA environmental analysis.' });
  }
});

app.post('/api/farms/:id/scenario', requireAuth, async (req: AuthedRequest, res: Response) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  try {
    const params: ClimateScenarioParams = {
      rainfallChangePct: Number(req.body?.rainfallChangePct ?? 0),
      tempShiftC: Number(req.body?.tempShiftC ?? 0),
      extraHeatStressDays: Number(req.body?.extraHeatStressDays ?? 0),
      waterAvailabilityDropPct: Number(req.body?.waterAvailabilityDropPct ?? 0),
      extremeRainIntensity: req.body?.extremeRainIntensity ?? 'baseline',
    };
    const analysis = await fetchFarmEnvironmentalAnalysis(farm, false);
    const crops = (db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all() as any[]).map(rowToCrop);
    const strategies = generateRotationStrategies(farm, analysis, crops);
    const simulation = simulateClimateScenarios(farm, analysis, strategies, params);
    res.json({ simulation });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Scenario simulation failed.' });
  }
});

app.get('/api/farms/:id/chat', requireAuth, (req: AuthedRequest, res: Response) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  const rows = db
    .prepare(`SELECT id, farm_id, role, content, created_at FROM chat_messages WHERE farm_id = ? AND user_id = ? ORDER BY created_at ASC`)
    .all(farm.id, req.user!.id) as any[];
  res.json({
    messages: rows.map((r) => ({
      id: r.id,
      farmId: r.farm_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    })),
  });
});

app.post('/api/farms/:id/chat', requireAuth, rateLimiter(30), async (req: AuthedRequest, res: Response) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Question cannot be empty.' });

  try {
    const analysis = await fetchFarmEnvironmentalAnalysis(farm, false);
    const crops = (db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all() as any[]).map(rowToCrop);
    const strategies = generateRotationStrategies(farm, analysis, crops);
    const historyRows = db
      .prepare(`SELECT id, farm_id, role, content, created_at FROM chat_messages WHERE farm_id = ? AND user_id = ? ORDER BY created_at ASC`)
      .all(farm.id, req.user!.id) as any[];
    const history = historyRows.map((r) => ({
      id: r.id,
      farmId: r.farm_id,
      role: r.role as 'user' | 'assistant',
      content: r.content,
      createdAt: r.created_at,
    }));

    const { answer, modelUsed } = await askAgriAssistant(farm, analysis, strategies, history, message);

    const userMsgId = crypto.randomUUID();
    const asstMsgId = crypto.randomUUID();
    const now1 = new Date().toISOString();
    const now2 = new Date(Date.now() + 10).toISOString();

    const insertChat = db.prepare(`INSERT INTO chat_messages (id, farm_id, user_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
    insertChat.run(userMsgId, farm.id, req.user!.id, 'user', message, now1);
    insertChat.run(asstMsgId, farm.id, req.user!.id, 'assistant', answer, now2);

    writeAuditLog(req.user!.id, req.user!.email, 'AI_ASSISTANT_QUERY', 'farm', farm.id, `Model=${modelUsed}`, req.ip);

    res.json({
      userMessage: { id: userMsgId, farmId: farm.id, role: 'user', content: message, createdAt: now1 },
      assistantMessage: { id: asstMsgId, farmId: farm.id, role: 'assistant', content: answer, createdAt: now2 },
    });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'AI Assistant could not complete the request.' });
  }
});

app.delete('/api/farms/:id/chat', requireAuth, (req: AuthedRequest, res: Response) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  db.prepare(`DELETE FROM chat_messages WHERE farm_id = ? AND user_id = ?`).run(farm.id, req.user!.id);
  res.json({ ok: true });
});

app.get('/api/farms/:id/export/csv', requireAuth, async (req: AuthedRequest, res: Response) => {
  const farm = loadOwnedFarm(req, res);
  if (!farm) return;
  const analysis = await fetchFarmEnvironmentalAnalysis(farm, false);
  const crops = (db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all() as any[]).map(rowToCrop);
  const strategies = generateRotationStrategies(farm, analysis, crops);

  const lines: string[] = [];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  lines.push('SECTION,KEY,VALUE,NOTES');
  lines.push(`Farm,${esc('Name')},${esc(farm.name)},${esc(`${farm.district}, ${farm.region}, ${farm.country}`)}`);
  lines.push(`Farm,${esc('Coordinates')},${esc(`${farm.centroidLat}, ${farm.centroidLon}`)},${esc(`${farm.sizeHectares} ha | ${farm.farmingType}`)}`);
  lines.push(`Farm,${esc('Soil Profile')},${esc(`${farm.soilType} (${farm.soilTexture})`)},${esc(`pH=${farm.soilPh ?? 'Unknown'}, OM=${farm.organicMatterPct ?? 'Unknown'}%`)}`);
  lines.push(`Climate,${esc('Observed Period')},${esc(`${analysis.periodSummary.startDate} to ${analysis.periodSummary.endDate}`)},NASA POWER / GPM Heritage`);
  lines.push(`Climate,${esc('Total Rainfall (mm)')},${esc(analysis.periodSummary.totalRainMm)},${esc(`Longest dry spell: ${analysis.periodSummary.longestDrySpellDays} days`)}`);
  lines.push(`Climate,${esc('Mean Temp (C)')},${esc(analysis.periodSummary.avgTempC)},${esc(`Heat days >=35C: ${analysis.periodSummary.heatStressDaysAbove35C}`)}`);
  lines.push(`Terrain,${esc('SRTM Elevation / Slope')},${esc(`${analysis.elevationMeters ?? 'N/A'} m`)},${esc(`Slope ${analysis.terrainSlopePct ?? 'N/A'}%`)}`);
  lines.push('');
  lines.push('STRATEGY,TITLE,SEQUENCE,INDICATORS_SUMMARY');
  for (const s of strategies) {
    lines.push(
      `${esc(s.label)},${esc(s.title)},${esc(s.steps.map((st) => `${st.seasonLabel}: ${st.cropName}`).join(' -> '))},${esc(
        s.indicators.map((i) => `${i.indicator}: ${i.rating}`).join('; ')
      )}`
    );
  }
  lines.push('');
  lines.push('DAILY_DATE,TEMP_MEAN_C,TEMP_MAX_C,PRECIP_MM,SOIL_WETNESS_TOP,SOIL_WETNESS_ROOT,ET0_MM');
  for (const d of analysis.dailySeries) {
    lines.push(`${d.date},${d.tempMeanC ?? ''},${d.tempMaxC ?? ''},${d.precipMm ?? ''},${d.soilMoistureTop ?? ''},${d.soilMoistureRoot ?? ''},${d.et0Mm ?? ''}`);
  }

  writeAuditLog(req.user!.id, req.user!.email, 'EXPORT_CSV_REPORT', 'farm', farm.id, 'Generated CSV environmental & rotation report', req.ip);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${farm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-terravane-report.csv"`);
  res.send(lines.join('\n'));
});

// ---------------- CROP INTELLIGENCE DATABASE ----------------
app.get('/api/crops', requireAuth, (_req: AuthedRequest, res: Response) => {
  const rows = db.prepare(`SELECT * FROM crops ORDER BY name ASC`).all() as any[];
  res.json({ crops: rows.map(rowToCrop) });
});

app.post('/api/crops', requireAuth, requireRoles('expert', 'admin'), (req: AuthedRequest, res: Response) => {
  const b = req.body ?? {};
  if (!b.name || !b.scientificName || !b.family) {
    return res.status(400).json({ error: 'Crop name, scientific name, and family are required.' });
  }
  const id = String(b.id || b.name).toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const now = new Date().toISOString();
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
    b.growingDurationDays || '90–120 days',
    b.waterReqMm || '400–600 mm',
    b.waterTier || 'Moderate',
    Number(b.tempMinC ?? 14),
    Number(b.tempOptMinC ?? 22),
    Number(b.tempOptMaxC ?? 32),
    Number(b.tempMaxC ?? 38),
    b.soilPreference || 'Well-drained loam',
    Number(b.phMin ?? 5.5),
    Number(b.phMax ?? 7.2),
    b.rootingDepthCm || '60–120 cm',
    b.rootingType || 'Taproot/fibrous',
    b.nutrientDemand || 'Moderate',
    Number(b.nitrogenFixingKgHa ?? 0),
    b.organicMatterContrib || 'Moderate',
    b.foragePotential || 'Moderate crop residue',
    b.pestDiseaseNotes || 'Monitor local pests.',
    b.suitableSeasons || 'Main rainy season',
    JSON.stringify(Array.isArray(b.compatiblePredecessors) ? b.compatiblePredecessors : []),
    JSON.stringify(Array.isArray(b.incompatiblePredecessors) ? b.incompatiblePredecessors : []),
    JSON.stringify(Array.isArray(b.regions) ? b.regions : ['West Africa', 'East Africa']),
    req.user!.email,
    now
  );
  writeAuditLog(req.user!.id, req.user!.email, 'CROP_CREATED', 'crop', id, `Added crop ${b.name}`, req.ip);
  const created = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(id);
  res.status(201).json({ crop: rowToCrop(created) });
});

app.put('/api/crops/:id', requireAuth, requireRoles('expert', 'admin'), (req: AuthedRequest, res: Response) => {
  const existing = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Crop not found.' });
  const b = req.body ?? {};
  const now = new Date().toISOString();

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
    req.user!.email,
    now,
    req.params.id
  );
  writeAuditLog(req.user!.id, req.user!.email, 'CROP_UPDATED', 'crop', req.params.id, `Updated ${b.name ?? existing.name}`, req.ip);
  const updated = db.prepare(`SELECT * FROM crops WHERE id = ?`).get(req.params.id);
  res.json({ crop: rowToCrop(updated) });
});

app.delete('/api/crops/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  db.prepare(`DELETE FROM crops WHERE id = ?`).run(req.params.id);
  writeAuditLog(req.user!.id, req.user!.email, 'CROP_DELETED', 'crop', req.params.id, 'Removed crop entry', req.ip);
  res.json({ ok: true });
});

// ---------------- ADMINISTRATOR SYSTEM ----------------
app.get('/api/admin/overview', requireAuth, requireRoles('admin'), (_req: AuthedRequest, res: Response) => {
  const users = db.prepare(`SELECT id, email, name, role, verified, organization, region, active, created_at FROM users ORDER BY created_at DESC`).all();
  // Anonymized/governance farm registry view for admin health monitoring (no private farmer notes leaked)
  const farms = db
    .prepare(`SELECT id, name, country, region, district, size_hectares, farming_type, centroid_lat, centroid_lon, created_at FROM farms ORDER BY created_at DESC`)
    .all();
  const datasets = db.prepare(`SELECT * FROM dataset_configs`).all();
  const aiSettings = db.prepare(`SELECT * FROM ai_settings WHERE id = 'default'`).get();
  const announcements = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`).all();
  const auditLogs = db.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80`).all();
  const cacheCount = (db.prepare(`SELECT COUNT(*) as c FROM nasa_cache`).get() as { c: number }).c;
  const chatCount = (db.prepare(`SELECT COUNT(*) as c FROM chat_messages`).get() as { c: number }).c;
  const cropCount = (db.prepare(`SELECT COUNT(*) as c FROM crops`).get() as { c: number }).c;

  res.json({
    health: {
      database: 'SQLite WAL Connected',
      nasaPowerEndpoint: 'https://power.larc.nasa.gov/api',
      cachedGeospatialQueries: cacheCount,
      totalChatInteractions: chatCount,
      cropCatalogCount: cropCount,
      uptimeSeconds: Math.floor(process.uptime()),
    },
    users,
    farms,
    datasets,
    aiSettings,
    announcements,
    auditLogs,
  });
});

app.put('/api/admin/users/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  const { role, verified, active } = req.body ?? {};
  const target = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'User not found.' });
  db.prepare(`UPDATE users SET role = ?, verified = ?, active = ? WHERE id = ?`).run(
    role ?? target.role,
    verified !== undefined ? (verified ? 1 : 0) : target.verified,
    active !== undefined ? (active ? 1 : 0) : target.active,
    req.params.id
  );
  writeAuditLog(req.user!.id, req.user!.email, 'ADMIN_USER_UPDATED', 'user', req.params.id, `role=${role ?? target.role}, active=${active ?? target.active}`, req.ip);
  res.json({ ok: true });
});

app.put('/api/admin/datasets/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  const { enabled, limitations, processingMethod } = req.body ?? {};
  const target = db.prepare(`SELECT * FROM dataset_configs WHERE id = ?`).get(req.params.id) as any;
  if (!target) return res.status(404).json({ error: 'Dataset configuration not found.' });
  db.prepare(`UPDATE dataset_configs SET enabled = ?, limitations = ?, processing_method = ? WHERE id = ?`).run(
    enabled !== undefined ? (enabled ? 1 : 0) : target.enabled,
    limitations ?? target.limitations,
    processingMethod ?? target.processing_method,
    req.params.id
  );
  writeAuditLog(req.user!.id, req.user!.email, 'ADMIN_DATASET_UPDATED', 'dataset', req.params.id, `enabled=${enabled}`, req.ip);
  res.json({ ok: true });
});

app.put('/api/admin/ai-settings', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  const { modelName, systemTone, strictScientificDisclaimer, maxHistoryTurns } = req.body ?? {};
  const allowedModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
  const safeModel = allowedModels.includes(modelName) ? modelName : 'gemini-4-hydrogen';
  db.prepare(
    `UPDATE ai_settings SET model_name = ?, system_tone = ?, strict_scientific_disclaimer = ?, max_history_turns = ?, updated_at = ? WHERE id = 'default'`
  ).run(
    safeModel,
    String(systemTone || 'Practical, respectful agronomic advisor grounded in empirical observation'),
    strictScientificDisclaimer ? 1 : 0,
    Math.min(24, Math.max(4, Number(maxHistoryTurns || 12))),
    new Date().toISOString()
  );
  writeAuditLog(req.user!.id, req.user!.email, 'ADMIN_AI_SETTINGS_UPDATED', 'ai_settings', 'default', `model=${safeModel}`, req.ip);
  res.json({ ok: true });
});

app.post('/api/admin/announcements', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  const { title, body, severity } = req.body ?? {};
  if (!title || !body) return res.status(400).json({ error: 'Announcement title and body are required.' });
  const id = `ann-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(`INSERT INTO announcements (id, title, body, severity, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)`).run(
    id,
    String(title).trim(),
    String(body).trim(),
    severity || 'info',
    req.user!.name,
    new Date().toISOString()
  );
  writeAuditLog(req.user!.id, req.user!.email, 'ANNOUNCEMENT_CREATED', 'announcement', id, title, req.ip);
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/announcements/:id', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  db.prepare(`DELETE FROM announcements WHERE id = ?`).run(req.params.id);
  writeAuditLog(req.user!.id, req.user!.email, 'ANNOUNCEMENT_DELETED', 'announcement', req.params.id, 'Removed announcement', req.ip);
  res.json({ ok: true });
});

app.post('/api/admin/cache/clear', requireAuth, requireRoles('admin'), (req: AuthedRequest, res: Response) => {
  db.prepare(`DELETE FROM nasa_cache`).run();
  writeAuditLog(req.user!.id, req.user!.email, 'NASA_CACHE_CLEARED', 'cache', 'all', 'Cleared cached NASA POWER/SRTM responses', req.ip);
  res.json({ ok: true });
});

// ---------------- START SERVER (VITE IN DEV, STATIC IN PROD) ----------------
async function startServer() {
  const port = Number(process.env.PORT || 3000);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`TerraVane server running on http://0.0.0.0:${port}`);
  });
}

startServer();
