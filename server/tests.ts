import assert from 'node:assert/strict';
import { db, hashPassword, initDatabase, verifyPassword } from './db.ts';
import { generateRotationStrategies, simulateClimateScenarios } from './rotationEngine.ts';
import { evaluatePotentialHazards } from './weatherHazards.ts';
import type { Crop, EnvironmentalAnalysis, Farm } from '../src/types.ts';

initDatabase();

// 1. Password hashing verification
const hashed = hashPassword('FarmNovaTest2026!');
assert.equal(verifyPassword('FarmNovaTest2026!', hashed), true);
assert.equal(verifyPassword('WrongPassword', hashed), false);

// 2. Crop database seeded with African & cover crops
const cropsCount = (db.prepare(`SELECT COUNT(*) as c FROM crops`).get() as { c: number }).c;
assert.ok(cropsCount >= 15, `Expected >= 15 crops seeded, got ${cropsCount}`);

// 3. Rotation engine produces 3 distinct transparent strategies without invented scores
const sampleFarm: Farm = {
  id: 'test-farm',
  ownerId: 'user-farmer-1',
  name: 'Test Ejura Plot',
  country: 'Ghana',
  region: 'Ashanti',
  district: 'Ejura',
  sizeHectares: 4.0,
  farmingType: 'Rainfed mixed',
  centroidLat: 7.3833,
  centroidLon: -1.3667,
  polygonCoords: [],
  soilType: 'Savanna Ochrosol',
  soilTexture: 'Sandy Loam',
  drainage: 'Well-drained',
  soilFertility: 'Moderate',
  organicMatterPct: null,
  soilPh: null,
  irrigationAvailable: 'None',
  soilNotes: '',
  previousCrops: ['Maize', 'Maize'],
  currentCrops: ['Maize'],
  plannedCrops: ['Cowpea'],
  plantingSeasons: 'Major & minor rains',
  harvestPeriods: 'Aug & Dec',
  pestHistory: 'Striga',
  availableWater: 'Rainfed',
  equipmentNotes: '',
  marketPreferences: 'Maize and Cowpea',
  priorities: ['Improving soil health', 'Conserving water', 'Reducing pest pressure'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockEnv: EnvironmentalAnalysis = {
  farmId: 'test-farm',
  fetchedAt: new Date().toISOString(),
  cacheHit: false,
  coordinates: { lat: 7.3833, lon: -1.3667 },
  elevationMeters: 241,
  terrainSlopePct: 2.3,
  erosionRiskContext: 'Moderate slope',
  periodSummary: {
    startDate: '2025-11-01',
    endDate: '2026-11-01',
    totalRainMm: 620,
    avgTempC: 27.5,
    maxTempObservedC: 37.8,
    heatStressDaysAbove35C: 22,
    longestDrySpellDays: 24,
    extremeRainDaysAbove30Mm: 3,
    avgTopSoilWetness: 0.42,
    avgRootSoilWetness: 0.48,
    soilMoistureAnomalyPct: -9.5,
    avgSolarRadiation: 18.4,
    estimatedAnnualEt0Mm: 1420,
    waterBalanceMm: -800,
    ndviProxyContext: 'Dry anomaly',
  },
  dailySeries: [],
  monthlySeries: [],
  datasets: [],
  insights: [],
  areasForInvestigation: [],
};

const cropRows = db.prepare(`SELECT * FROM crops`).all() as any[];
const crops: Crop[] = cropRows.map((r) => ({
  id: r.id,
  name: r.name,
  scientificName: r.scientific_name,
  family: r.family,
  growingDurationDays: r.growing_duration_days,
  waterReqMm: r.water_req_mm,
  waterTier: r.water_tier,
  tempMinC: r.temp_min_c,
  tempOptMinC: r.temp_opt_min_c,
  tempOptMaxC: r.temp_opt_max_c,
  tempMaxC: r.temp_max_c,
  soilPreference: r.soil_preference,
  phMin: r.ph_min,
  phMax: r.ph_max,
  rootingDepthCm: r.rooting_depth_cm,
  rootingType: r.rooting_type,
  nutrientDemand: r.nutrient_demand,
  nitrogenFixingKgHa: r.nitrogen_fixing_kg_ha,
  organicMatterContrib: r.organic_matter_contrib,
  foragePotential: r.forage_potential,
  pestDiseaseNotes: r.pest_disease_notes,
  suitableSeasons: r.suitable_seasons,
  compatiblePredecessors: JSON.parse(r.compatible_predecessors_json),
  incompatiblePredecessors: JSON.parse(r.incompatible_predecessors_json),
  regions: JSON.parse(r.regions_json),
}));

const strategies = generateRotationStrategies(sampleFarm, mockEnv, crops);
assert.equal(strategies.length, 3);
assert.equal(strategies[0].indicators.length, 8);
assert.ok(strategies[1].missingInformation.some((m) => m.includes('pH')));

// 4. Climate scenario simulator returns 3 outcomes and disclaimer
const sim = simulateClimateScenarios(sampleFarm, mockEnv, strategies, {
  rainfallChangePct: -25,
  tempShiftC: 2.0,
  extraHeatStressDays: 15,
  waterAvailabilityDropPct: 20,
  extremeRainIntensity: 'moderate',
});
assert.equal(sim.outcomes.length, 3);
assert.ok(sim.disclaimer.includes('NOT A WEATHER FORECAST'));

// 5. Hazard evaluator detects heavy rain and frost/heat thresholds cleanly
const hazards = evaluatePotentialHazards(sampleFarm, mockEnv, {
  source: 'Test',
  fetchedAt: new Date().toISOString(),
  current: {
    observedAt: '2026-11-14T12:00',
    timezone: 'UTC',
    temperatureC: 36,
    feelsLikeC: 38,
    humidityPct: 86,
    precipMm: 0,
    windKmh: 15,
    windGustKmh: 50,
    weatherCode: 95,
    conditionLabel: 'Thunderstorm',
    conditionSummary: 'Storm expected',
  },
  daily: [
    {
      date: '2026-11-15',
      dayLabel: 'Tomorrow',
      weatherCode: 95,
      conditionLabel: 'Thunderstorm',
      tempMaxC: 38,
      tempMinC: 24,
      precipSumMm: 42,
      precipProbPct: 90,
      windMaxKmh: 30,
      windGustMaxKmh: 52,
      et0Mm: 4.5,
      uvIndexMax: 8,
    },
  ],
  weeklyRainTotalMm: 42,
  maxForecastTempC: 38,
  minForecastTempC: 24,
});
assert.ok(hazards.some((h) => h.type === 'Flood / Heavy Rain'));
assert.ok(hazards.some((h) => h.type === 'Heatwave'));
assert.ok(hazards.some((h) => h.type === 'High Wind'));

console.log('All FarmNova AI backend unit tests passed successfully.');
