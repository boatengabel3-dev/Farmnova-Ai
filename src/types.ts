export type UserRole = 'farmer' | 'expert' | 'researcher' | 'admin';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  verified: boolean;
  organization: string;
  region: string;
  preferredUnits: 'metric' | 'imperial';
  createdAt: string;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Farm {
  id: string;
  ownerId: string;
  ownerName?: string;
  name: string;
  country: string;
  region: string;
  district: string;
  sizeHectares: number;
  farmingType: string;
  centroidLat: number;
  centroidLon: number;
  polygonCoords: GeoPoint[];
  soilType: string;
  soilTexture: string;
  drainage: string;
  soilFertility: string;
  organicMatterPct: number | null;
  soilPh: number | null;
  irrigationAvailable: string;
  soilNotes: string;
  previousCrops: string[];
  currentCrops: string[];
  plannedCrops: string[];
  plantingSeasons: string;
  harvestPeriods: string;
  pestHistory: string;
  availableWater: string;
  equipmentNotes: string;
  marketPreferences: string;
  priorities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Crop {
  id: string;
  name: string;
  scientificName: string;
  family: string;
  growingDurationDays: string;
  waterReqMm: string;
  waterTier: 'Low' | 'Moderate' | 'High';
  tempMinC: number;
  tempOptMinC: number;
  tempOptMaxC: number;
  tempMaxC: number;
  soilPreference: string;
  phMin: number;
  phMax: number;
  rootingDepthCm: string;
  rootingType: string;
  nutrientDemand: 'Light' | 'Moderate' | 'Heavy';
  nitrogenFixingKgHa: number;
  organicMatterContrib: 'Low' | 'Moderate' | 'High';
  foragePotential: string;
  pestDiseaseNotes: string;
  suitableSeasons: string;
  compatiblePredecessors: string[];
  incompatiblePredecessors: string[];
  regions: string[];
  updatedBy?: string;
  updatedAt?: string;
}

export interface DatasetProvenance {
  id: string;
  datasetName: string;
  missionCode: string;
  dataSource: string;
  observationDate: string;
  spatialResolution: string;
  temporalResolution: string;
  processingMethod: string;
  dataQuality: 'Verified Live' | 'Regional Context' | 'Partially Missing' | 'Unavailable Locally';
  missingObservations: number;
  limitations: string;
  enabled: boolean;
}

export interface DailyWeatherPoint {
  date: string;
  tempMeanC: number | null;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipMm: number | null;
  soilMoistureTop: number | null;
  soilMoistureRoot: number | null;
  solarRadiation: number | null;
  humidityPct: number | null;
  et0Mm: number | null;
}

export interface MonthlyClimatePoint {
  month: string;
  label: string;
  precipMm: number | null;
  tempMeanC: number | null;
  soilMoistureRoot: number | null;
}

export interface EnvironmentalInsight {
  id: string;
  category: 'Rainfall' | 'Temperature' | 'Soil Moisture' | 'Vegetation' | 'Water Storage' | 'Terrain';
  title: string;
  observationType: 'Direct Satellite Observation' | 'Derived Environmental Indicator' | 'Regional Context Only';
  whatWasObserved: string;
  whenObserved: string;
  whatItCouldMean: string;
  whatItCannotEstablish: string;
  additionalInfoNeeded: string;
  statusLevel: 'Nominal' | 'Watch' | 'Elevated Stress' | 'Insufficient Data';
}

export interface CurrentWeatherObservation {
  observedAt: string;
  timezone: string;
  temperatureC: number | null;
  feelsLikeC: number | null;
  humidityPct: number | null;
  precipMm: number | null;
  windKmh: number | null;
  windGustKmh: number | null;
  weatherCode: number | null;
  conditionLabel: string;
  conditionSummary: string;
}

export interface ForecastDay {
  date: string;
  dayLabel: string;
  weatherCode: number | null;
  conditionLabel: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  precipSumMm: number | null;
  precipProbPct: number | null;
  windMaxKmh: number | null;
  windGustMaxKmh: number | null;
  et0Mm: number | null;
  uvIndexMax: number | null;
}

export interface RealtimeWeatherForecast {
  source: string;
  fetchedAt: string;
  current: CurrentWeatherObservation;
  daily: ForecastDay[];
  weeklyRainTotalMm: number;
  maxForecastTempC: number | null;
  minForecastTempC: number | null;
}

export interface FarmHazard {
  id: string;
  type: 'Heatwave' | 'Flood / Heavy Rain' | 'Dry Spell / Drought' | 'High Wind' | 'Fungal / Humidity' | 'Frost / Cold' | 'Soil Erosion';
  title: string;
  severity: 'Low' | 'Moderate' | 'High' | 'Severe';
  timingWindow: string;
  plainSummary: string;
  triggerDetail: string;
  farmerActions: string[];
}

export interface EnvironmentalAnalysis {
  farmId: string;
  fetchedAt: string;
  cacheHit: boolean;
  coordinates: { lat: number; lon: number };
  elevationMeters: number | null;
  terrainSlopePct: number | null;
  erosionRiskContext: string;
  periodSummary: {
    startDate: string;
    endDate: string;
    totalRainMm: number | null;
    avgTempC: number | null;
    maxTempObservedC: number | null;
    heatStressDaysAbove35C: number;
    longestDrySpellDays: number;
    extremeRainDaysAbove30Mm: number;
    avgTopSoilWetness: number | null;
    avgRootSoilWetness: number | null;
    soilMoistureAnomalyPct: number | null;
    avgSolarRadiation: number | null;
    estimatedAnnualEt0Mm: number | null;
    waterBalanceMm: number | null;
    ndviProxyContext: string;
  };
  dailySeries: DailyWeatherPoint[];
  monthlySeries: MonthlyClimatePoint[];
  datasets: DatasetProvenance[];
  insights: EnvironmentalInsight[];
  areasForInvestigation: string[];
  realtimeForecast?: RealtimeWeatherForecast;
  hazards?: FarmHazard[];
}

export type IndicatorRating = 'High Benefit' | 'Moderate Benefit' | 'Balanced' | 'Elevated Demand' | 'Higher Risk' | 'Needs Validation';

export interface RotationStep {
  seasonLabel: string;
  cropName: string;
  cropFamily: string;
  plantingWindow: string;
  durationDays: string;
  roleInRotation: string;
}

export interface StrategyIndicator {
  indicator:
    | 'Soil Health'
    | 'Water Demand'
    | 'Nutrient Cycling'
    | 'Organic Matter'
    | 'Erosion'
    | 'Pest Management'
    | 'Climate Resilience'
    | 'Market Suitability';
  rating: IndicatorRating;
  explanation: string;
  alignmentWithPriorities: string;
}

export interface RotationStrategy {
  id: 'strategy_a' | 'strategy_b' | 'strategy_c';
  label: string;
  title: string;
  subtitle: string;
  steps: RotationStep[];
  soilHealthBenefits: string;
  nutrientCycling: string;
  waterRequirements: string;
  erosionReduction: string;
  organicMatterContribution: string;
  pestCycleDisruption: string;
  forageOpportunities: string;
  marketConsiderations: string;
  environmentalRisks: string[];
  missingInformation: string[];
  requiredLocalValidation: string[];
  indicators: StrategyIndicator[];
}

export interface ClimateScenarioParams {
  rainfallChangePct: number;
  tempShiftC: number;
  extraHeatStressDays: number;
  waterAvailabilityDropPct: number;
  extremeRainIntensity: 'baseline' | 'moderate' | 'severe';
}

export interface ScenarioStrategyOutcome {
  strategyId: string;
  strategyTitle: string;
  projectedWaterBalanceNote: string;
  thermalStressExposure: 'Low' | 'Moderate' | 'High';
  moistureVulnerability: 'Low' | 'Moderate' | 'High';
  erosionExposure: 'Low' | 'Moderate' | 'High';
  agronomicSummary: string;
  adaptationActions: string[];
}

export interface ClimateScenarioResult {
  disclaimer: string;
  baselineSummary: {
    annualRainMm: number | null;
    meanTempC: number | null;
    simulatedRainMm: number | null;
    simulatedTempC: number | null;
  };
  monthlyComparison: Array<{
    month: string;
    baselineRainMm: number;
    scenarioRainMm: number;
    baselineTempC: number;
    scenarioTempC: number;
  }>;
  outcomes: ScenarioStrategyOutcome[];
}

export interface ChatMessage {
  id: string;
  farmId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'advisory' | 'maintenance';
  active: boolean;
  createdBy: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string | null;
  userEmail: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: string;
  ip: string;
  createdAt: string;
}
