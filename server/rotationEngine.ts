import type {
  ClimateScenarioParams,
  ClimateScenarioResult,
  Crop,
  EnvironmentalAnalysis,
  Farm,
  IndicatorRating,
  RotationStrategy,
  StrategyIndicator,
} from '../src/types.ts';

function pickCrop(crops: Crop[], preferredNames: string[], fallbackName: string): Crop {
  for (const name of preferredNames) {
    const found = crops.find((c) => c.name.toLowerCase().includes(name.toLowerCase()));
    if (found) return found;
  }
  return crops.find((c) => c.name.toLowerCase().includes(fallbackName.toLowerCase())) ?? crops[0];
}

function hasPriority(farm: Farm, keyword: string): boolean {
  return farm.priorities.some((p) => p.toLowerCase().includes(keyword.toLowerCase()));
}

function makeIndicators(
  farm: Farm,
  ratings: Record<StrategyIndicator['indicator'], { rating: IndicatorRating; explanation: string; priorityKey: string }>
): StrategyIndicator[] {
  const order: StrategyIndicator['indicator'][] = [
    'Soil Health',
    'Water Demand',
    'Nutrient Cycling',
    'Organic Matter',
    'Erosion',
    'Pest Management',
    'Climate Resilience',
    'Market Suitability',
  ];

  return order.map((indicator) => {
    const item = ratings[indicator];
    const matched = hasPriority(farm, item.priorityKey);
    return {
      indicator,
      rating: item.rating,
      explanation: item.explanation,
      alignmentWithPriorities: matched
        ? `Directly addresses your selected priority (${item.priorityKey}).`
        : 'Secondary co-benefit relative to your top selected priorities.',
    };
  });
}

export function generateRotationStrategies(
  farm: Farm,
  env: EnvironmentalAnalysis,
  crops: Crop[]
): RotationStrategy[] {
  const totalRain = env.periodSummary.totalRainMm ?? 800;
  const heatDays = env.periodSummary.heatStressDaysAbove35C;
  const slopePct = env.terrainSlopePct ?? 1.5;
  const isDryland = totalRain < 680 || env.periodSummary.longestDrySpellDays >= 18;
  const isSteep = slopePct >= 4.0;
  const wantsForage = hasPriority(farm, 'forage');
  const wantsErosion = hasPriority(farm, 'erosion') || isSteep;
  const wantsMarket = hasPriority(farm, 'market');
  const wantsWater = hasPriority(farm, 'water') || isDryland;

  const missingInfo: string[] = [];
  if (farm.soilPh === null) missingInfo.push('Laboratory soil pH is unknown (limits precision for pH-sensitive legumes such as Soybean).');
  if (farm.organicMatterPct === null) missingInfo.push('Baseline soil organic matter (%) is unknown.');
  if (farm.soilFertility.toLowerCase().includes('unknown')) missingInfo.push('Current soil N-P-K fertility status is unmeasured.');
  if (totalRain === null) missingInfo.push('Local rain-gauge validation of NASA 0.5° precipitation data.');

  const currentCropName = farm.currentCrops[0] || farm.previousCrops[0] || 'Maize';
  const prevCropName = farm.previousCrops[0] || currentCropName;
  const secondCurrent = farm.currentCrops[1] || currentCropName;

  const baseCrop1 = pickCrop(crops, [currentCropName], 'Maize');
  const baseCrop2 = pickCrop(crops, [secondCurrent, prevCropName], 'Maize');

  const isMonocropCereal =
    baseCrop1.family.includes('Poaceae') &&
    baseCrop2.family.includes('Poaceae') &&
    farm.previousCrops.every((c) => !c.toLowerCase().includes('cowpea') && !c.toLowerCase().includes('groundnut') && !c.toLowerCase().includes('soy'));

  // Strategy A: Existing / Baseline Rotation
  const strategyA: RotationStrategy = {
    id: 'strategy_a',
    label: 'Strategy A',
    title: 'Current Practice Baseline',
    subtitle: `Continuation of ${[...new Set([prevCropName, currentCropName])].join(' → ')} sequence`,
    steps: [
      {
        seasonLabel: 'Season 1 (Major Rains)',
        cropName: baseCrop1.name,
        cropFamily: baseCrop1.family,
        plantingWindow: farm.plantingSeasons || 'Main rainy onset',
        durationDays: baseCrop1.growingDurationDays,
        roleInRotation: 'Primary staple / current baseline crop',
      },
      {
        seasonLabel: 'Season 2 (Minor / Next Cycle)',
        cropName: baseCrop2.name,
        cropFamily: baseCrop2.family,
        plantingWindow: 'Secondary rains or next main season',
        durationDays: baseCrop2.growingDurationDays,
        roleInRotation: 'Repeated baseline crop pattern',
      },
      {
        seasonLabel: 'Season 3 (Year 2 Major)',
        cropName: baseCrop1.name,
        cropFamily: baseCrop1.family,
        plantingWindow: 'Main rainy onset',
        durationDays: baseCrop1.growingDurationDays,
        roleInRotation: 'Continued staple production without structural break',
      },
      {
        seasonLabel: 'Season 4 (Year 2 Minor)',
        cropName: farm.plannedCrops[0] ? pickCrop(crops, [farm.plannedCrops[0]], baseCrop2.name).name : baseCrop2.name,
        cropFamily: farm.plannedCrops[0] ? pickCrop(crops, [farm.plannedCrops[0]], baseCrop2.name).family : baseCrop2.family,
        plantingWindow: 'Secondary window',
        durationDays: baseCrop2.growingDurationDays,
        roleInRotation: 'Farmer planned follow-up',
      },
    ],
    soilHealthBenefits: isMonocropCereal
      ? 'Minimal soil-building benefit when cereal grasses repeat consecutively; root architecture remains in the same shallow-to-mid soil horizon.'
      : 'Maintains familiar soil management, though lacks dedicated cover-crop biomass restoration.',
    nutrientCycling: isMonocropCereal
      ? 'Continuous net nitrogen and phosphorus extraction without biological N2 fixation increases reliance on mineral fertilizer.'
      : 'Partial nutrient cycling depending on residue incorporation.',
    waterRequirements: `Matches existing water demand (${baseCrop1.waterReqMm}); ${isDryland ? 'vulnerable during multi-week dry spells if high-demand maize dominates.' : 'generally supported by observed annual rainfall if planting is timely.'}`,
    erosionReduction: isSteep
      ? 'Exposed inter-row soil during early establishment presents elevated sheet erosion risk on your ~' + slopePct + '% slope.'
      : 'Moderate surface residue if stover is left unburned on the field.',
    organicMatterContribution: 'Low to moderate unless all crop stover is retained rather than burned or removed.',
    pestCycleDisruption: isMonocropCereal
      ? 'Weak pest-cycle disruption: continuous Poaceae hosts sustain Fall Armyworm, stem borers, and Striga seedbanks.'
      : 'Limited host-family interruption across seasons.',
    forageOpportunities: baseCrop1.foragePotential,
    marketConsiderations: 'High familiarity with existing buyers and storage channels; avoids immediate seed-sourcing changes.',
    environmentalRisks: [
      ...(isMonocropCereal ? ['Progressive nitrogen depletion and Striga/armyworm carryover across continuous cereal seasons.'] : []),
      ...(heatDays >= 15 ? [`Observed ${heatDays} regional days ≥35 °C pose flowering heat-stress risk if varieties are not staggered.`] : []),
      ...(isDryland ? ['High sensitivity to mid-season dry spells observed in NASA POWER precipitation records.'] : []),
    ],
    missingInformation: missingInfo,
    requiredLocalValidation: [
      'Confirm actual seasonal yields over the past 2–3 harvests to quantify nutrient drawdown.',
      'Inspect field patches for Striga emergence or root-feeding pests.',
    ],
    indicators: makeIndicators(farm, {
      'Soil Health': {
        rating: isMonocropCereal ? 'Higher Risk' : 'Balanced',
        explanation: isMonocropCereal ? 'Repeated cereal extraction degrades soil structure and nitrogen over time.' : 'Maintains baseline soil status without active restoration.',
        priorityKey: 'soil health',
      },
      'Water Demand': {
        rating: baseCrop1.waterTier === 'High' ? 'Elevated Demand' : 'Balanced',
        explanation: `Dominated by ${baseCrop1.name} (${baseCrop1.waterReqMm} seasonal requirement).`,
        priorityKey: 'water',
      },
      'Nutrient Cycling': {
        rating: isMonocropCereal ? 'Higher Risk' : 'Balanced',
        explanation: 'Zero biological nitrogen fixation in cereal-only cycles.',
        priorityKey: 'nutrient',
      },
      'Organic Matter': {
        rating: 'Balanced',
        explanation: 'Depends strictly on whether stover residues are retained as mulch.',
        priorityKey: 'organic matter',
      },
      Erosion: {
        rating: isSteep ? 'Higher Risk' : 'Balanced',
        explanation: isSteep ? 'Wide-spaced row crops leave topsoil exposed on sloped ground.' : 'Moderate ground cover during peak canopy only.',
        priorityKey: 'erosion',
      },
      'Pest Management': {
        rating: isMonocropCereal ? 'Higher Risk' : 'Balanced',
        explanation: 'Same-family host continuity sustains pest and weed lifecycles.',
        priorityKey: 'pest',
      },
      'Climate Resilience': {
        rating: isDryland || heatDays > 15 ? 'Higher Risk' : 'Balanced',
        explanation: 'Single-crop timing increases vulnerability to rainfall onset shifts or heat spikes.',
        priorityKey: 'rainfall',
      },
      'Market Suitability': {
        rating: 'High Benefit',
        explanation: 'Fully aligned with established local market channels and farmer equipment.',
        priorityKey: 'market',
      },
    }),
  };

  // Strategy B: Soil & Moisture Resilience Rotation (Legume + Drought/Heat-Resilient Cereal + Cover Biomass)
  const droughtCereal = pickCrop(crops, isDryland ? ['Sorghum', 'Pearl Millet'] : ['Maize', 'Sorghum'], 'Sorghum');
  const resilientLegume = pickCrop(crops, isDryland ? ['Cowpea', 'Lablab Bean'] : ['Cowpea', 'Groundnut'], 'Cowpea');
  const restorativeCover = pickCrop(
    crops,
    wantsForage ? ['Lablab Bean', 'Pigeon Pea'] : wantsErosion ? ['Mucuna (Velvet Bean)', 'Sunn Hemp'] : ['Sunn Hemp', 'Mucuna (Velvet Bean)'],
    'Mucuna'
  );
  const anchorCropB = pickCrop(crops, isDryland ? ['Pearl Millet', 'Sorghum'] : ['Maize', 'Sweet Potato'], 'Maize');

  const strategyB: RotationStrategy = {
    id: 'strategy_b',
    label: 'Strategy B',
    title: 'Soil & Moisture Resilience Sequence',
    subtitle: `${resilientLegume.name} → ${anchorCropB.name} → ${restorativeCover.name} → ${droughtCereal.name}`,
    steps: [
      {
        seasonLabel: 'Season 1 (Soil Rebuild & N-Fixation)',
        cropName: resilientLegume.name,
        cropFamily: resilientLegume.family,
        plantingWindow: 'Early rains / transition window',
        durationDays: resilientLegume.growingDurationDays,
        roleInRotation: `Fixes ~${resilientLegume.nitrogenFixingKgHa} kg N/ha and disrupts cereal pest/Striga cycles`,
      },
      {
        seasonLabel: 'Season 2 (Main Staple Harvest)',
        cropName: anchorCropB.name,
        cropFamily: anchorCropB.family,
        plantingWindow: 'Main rainy season onset',
        durationDays: anchorCropB.growingDurationDays,
        roleInRotation: 'Captures residual biological nitrogen fixed in Season 1',
      },
      {
        seasonLabel: 'Season 3 (Biomass & Canopy Cover)',
        cropName: restorativeCover.name,
        cropFamily: restorativeCover.family,
        plantingWindow: 'Minor rains or relay-sown',
        durationDays: restorativeCover.growingDurationDays,
        roleInRotation: 'Dense canopy curbs erosion, suppresses weeds, and builds organic matter',
      },
      {
        seasonLabel: 'Season 4 (Drought-Buffered Cereal)',
        cropName: droughtCereal.name,
        cropFamily: droughtCereal.family,
        plantingWindow: 'Main rains',
        durationDays: droughtCereal.growingDurationDays,
        roleInRotation: 'Deep-rooted grain & fodder resilience under erratic rainfall',
      },
    ],
    soilHealthBenefits:
      'Alternates deep taproots (legumes/cover crops) with fibrous cereal roots to break compaction layers, increase microbial diversity, and rebuild topsoil structure.',
    nutrientCycling: `Combines ${resilientLegume.name} (~${resilientLegume.nitrogenFixingKgHa} kg N/ha) and ${restorativeCover.name} (~${restorativeCover.nitrogenFixingKgHa} kg N/ha) ahead of heavy-feeding cereals.`,
    waterRequirements: `${wantsWater ? 'Lower seasonal moisture risk: ' : ''}${resilientLegume.name} (${resilientLegume.waterReqMm}) and ${droughtCereal.name} (${droughtCereal.waterReqMm}) tolerate intermittent dry spells better than continuous maize.`,
    erosionReduction: `Dense trailing canopy from ${restorativeCover.name} shields bare soil from intense ≥30 mm storm impact on ${slopePct}% terrain.`,
    organicMatterContribution: `High biomass return from ${restorativeCover.name} and legume leaf drop supports long-term organic carbon recovery.`,
    pestCycleDisruption: `Alternating Fabaceae and Poaceae breaks Fall Armyworm, stem borer, and Striga hermonthica cycles (${resilientLegume.name} acts as a false Striga host).`,
    forageOpportunities: `${resilientLegume.name} haulms and ${droughtCereal.name} stover provide protein-balanced dry-season livestock feed.`,
    marketConsiderations: 'Trades one minor-season cash harvest for a soil-building cover/forage crop; long-term yield stability offsets short-term cover-crop seed cost.',
    environmentalRisks: [
      'Cover crop biomass requires timely termination before seed set or before planting the next staple to avoid moisture competition.',
      ...(farm.soilPh !== null && farm.soilPh < 5.3 ? ['Low soil pH (<5.3) may reduce rhizobial nodulation efficiency without local organic amendment or liming.'] : []),
    ],
    missingInformation: missingInfo,
    requiredLocalValidation: [
      `Confirm local seed availability and rhizobium inoculant access for ${resilientLegume.name} and ${restorativeCover.name}.`,
      'Verify whether livestock free-grazing rules allow retaining cover-crop mulch on the field during the dry season.',
    ],
    indicators: makeIndicators(farm, {
      'Soil Health': {
        rating: 'High Benefit',
        explanation: 'Multi-layer rooting plus two biological nitrogen-fixing phases actively restore soil structure.',
        priorityKey: 'soil health',
      },
      'Water Demand': {
        rating: 'High Benefit',
        explanation: 'Prioritizes drought-tolerant crops and mulch cover that reduces soil evaporation.',
        priorityKey: 'water',
      },
      'Nutrient Cycling': {
        rating: 'High Benefit',
        explanation: 'Dual legume/green-manure phases supply organic nitrogen ahead of cereals.',
        priorityKey: 'nutrient',
      },
      'Organic Matter': {
        rating: 'High Benefit',
        explanation: `${restorativeCover.name} contributes substantial surface mulch and root biomass.`,
        priorityKey: 'organic matter',
      },
      Erosion: {
        rating: 'High Benefit',
        explanation: 'Rapid ground cover reduces raindrop splash and surface runoff.',
        priorityKey: 'erosion',
      },
      'Pest Management': {
        rating: 'High Benefit',
        explanation: 'Two non-cereal breaks strongly suppress Striga, nematodes, and cereal borers.',
        priorityKey: 'pest',
      },
      'Climate Resilience': {
        rating: 'High Benefit',
        explanation: 'Spreads thermal and dry-spell risk across diverse planting windows and root depths.',
        priorityKey: 'rainfall',
      },
      'Market Suitability': {
        rating: 'Moderate Benefit',
        explanation: 'Strong grain/forage value, though Season 3 prioritizes soil recovery over direct cash sales.',
        priorityKey: 'market',
      },
    }),
  };

  // Strategy C: Market-Balanced Diversified Rotation (Cash Legume + Staple Cereal + Root/Cash Crop + Short Legume)
  const cashLegume = pickCrop(
    crops,
    farm.plannedCrops.some((p) => p.toLowerCase().includes('groundnut')) ? ['Groundnut', 'Soybean'] : ['Soybean', 'Groundnut'],
    'Soybean'
  );
  const stapleCereal = pickCrop(crops, [currentCropName, 'Maize', 'Sorghum'], 'Maize');
  const shortPulse = pickCrop(crops, ['Cowpea', 'Chickpea', 'Pigeon Pea'], 'Cowpea');
  const diversifiedCrop = pickCrop(
    crops,
    totalRain > 850 ? ['Sweet Potato (Orange-Fleshed)', 'Cassava', 'Groundnut'] : ['Groundnut', 'Pigeon Pea'],
    'Groundnut'
  );

  const strategyC: RotationStrategy = {
    id: 'strategy_c',
    label: 'Strategy C',
    title: 'Market-Balanced Diversified Rotation',
    subtitle: `${cashLegume.name} → ${stapleCereal.name} → ${shortPulse.name} → ${diversifiedCrop.name}`,
    steps: [
      {
        seasonLabel: 'Season 1 (High-Value N-Fixing Legume)',
        cropName: cashLegume.name,
        cropFamily: cashLegume.family,
        plantingWindow: 'Main rainy onset',
        durationDays: cashLegume.growingDurationDays,
        roleInRotation: `Commercial protein/oilseed crop fixing ~${cashLegume.nitrogenFixingKgHa} kg N/ha`,
      },
      {
        seasonLabel: 'Season 2 (Primary Staple Cereal)',
        cropName: stapleCereal.name,
        cropFamily: stapleCereal.family,
        plantingWindow: 'Following major or minor rains',
        durationDays: stapleCereal.growingDurationDays,
        roleInRotation: 'Benefits from legume residual N and cleaner weed-suppressed seedbed',
      },
      {
        seasonLabel: 'Season 3 (Short-Cycle Pulse Break)',
        cropName: shortPulse.name,
        cropFamily: shortPulse.family,
        plantingWindow: 'Minor rains / residual moisture',
        durationDays: shortPulse.growingDurationDays,
        roleInRotation: 'Fast harvestable grain & nitrogen recharge during shorter rain window',
      },
      {
        seasonLabel: 'Season 4 (Diversified Market / Root Crop)',
        cropName: diversifiedCrop.name,
        cropFamily: diversifiedCrop.family,
        plantingWindow: 'Year 2 rainy season',
        durationDays: diversifiedCrop.growingDurationDays,
        roleInRotation: 'Income diversification across different crop family and market price cycle',
      },
    ],
    soilHealthBenefits:
      'Maintains continuous harvestable output while alternating legumes, cereals, and non-cereal broadleaf/root crops across four seasons.',
    nutrientCycling: `Balances nitrogen export from ${stapleCereal.name} with two harvestable legume phases (${cashLegume.name} and ${shortPulse.name}); phosphorus and potassium replenishment remains essential because grain harvests export nutrients off-farm.`,
    waterRequirements: `${cashLegume.name} (${cashLegume.waterReqMm}) and ${stapleCereal.name} (${stapleCereal.waterReqMm}) carry moderate-to-high water needs during pod fill and tasseling.`,
    erosionReduction: 'Good canopy diversity across seasons, though lower surface mulch volume than a dedicated Mucuna/Sunn Hemp cover season.',
    organicMatterContribution: 'Moderate — depends on returning legume haulms and cereal stover after grain harvest.',
    pestCycleDisruption: 'Effective rotation across 3 distinct botanical families reduces single-crop insect and pathogen buildup.',
    forageOpportunities: `${shortPulse.name} haulms and cereal stover provide secondary feed alongside primary grain markets.`,
    marketConsiderations: `${wantsMarket ? 'Strongly aligned with market goals: ' : ''}Every season yields a marketable food or cash crop, spreading household income and price risk across 4 commodities.`,
    environmentalRisks: [
      `${cashLegume.name} requires reliable moisture during flowering/pod-fill and near-neutral pH (ideal ${cashLegume.phMin}–${cashLegume.phMax}).`,
      'Higher off-farm nutrient export when all four seasons are harvested for grain — monitor phosphorus and potassium balance.',
    ],
    missingInformation: missingInfo,
    requiredLocalValidation: [
      `Verify soil pH (${farm.soilPh !== null ? `reported ${farm.soilPh}` : 'currently unknown'}) and phosphorus levels before scaling ${cashLegume.name}.`,
      'Confirm local buyer demand, drying capacity (aflatoxin prevention for Groundnut/Maize), and certified seed availability.',
    ],
    indicators: makeIndicators(farm, {
      'Soil Health': {
        rating: 'Moderate Benefit',
        explanation: 'Alternates root depths and crop families across every season without sacrificing harvests.',
        priorityKey: 'soil health',
      },
      'Water Demand': {
        rating: isDryland ? 'Elevated Demand' : 'Balanced',
        explanation: `${cashLegume.name} and ${stapleCereal.name} need reliable pod-fill and grain-fill moisture.`,
        priorityKey: 'water',
      },
      'Nutrient Cycling': {
        rating: 'Moderate Benefit',
        explanation: 'Biological N fixation offsets part of cereal demand, though grain harvest exports P & K.',
        priorityKey: 'nutrient',
      },
      'Organic Matter': {
        rating: 'Moderate Benefit',
        explanation: 'Legume and cereal residues add moderate carbon if not removed for fuel or burning.',
        priorityKey: 'organic matter',
      },
      Erosion: {
        rating: 'Moderate Benefit',
        explanation: 'Spreading canopies like Groundnut/Cowpea protect soil better than cereal monoculture.',
        priorityKey: 'erosion',
      },
      'Pest Management': {
        rating: 'High Benefit',
        explanation: 'Alternating legume, cereal, and diversified family breaks pest continuity.',
        priorityKey: 'pest',
      },
      'Climate Resilience': {
        rating: 'Moderate Benefit',
        explanation: 'Diversified harvest windows buffer single-crop failure, though cash legumes are sensitive to severe drought.',
        priorityKey: 'rainfall',
      },
      'Market Suitability': {
        rating: 'High Benefit',
        explanation: 'Four marketable harvests diversify farm revenue and household nutrition.',
        priorityKey: 'market',
      },
    }),
  };

  return [strategyA, strategyB, strategyC];
}

export function simulateClimateScenarios(
  farm: Farm,
  env: EnvironmentalAnalysis,
  strategies: RotationStrategy[],
  params: ClimateScenarioParams
): ClimateScenarioResult {
  const baselineRain = env.periodSummary.totalRainMm ?? 850;
  const baselineTemp = env.periodSummary.avgTempC ?? 26.5;

  const simulatedRainMm = Number((baselineRain * (1 + params.rainfallChangePct / 100)).toFixed(0));
  const simulatedTempC = Number((baselineTemp + params.tempShiftC).toFixed(1));
  const effectiveRainAfterWaterDrop = simulatedRainMm * (1 - params.waterAvailabilityDropPct / 100);

  // Build monthly comparison from real monthly baseline or 12-month average fallback
  const recent12Months = env.monthlySeries.slice(-12);
  const monthlyComparison =
    recent12Months.length >= 6
      ? recent12Months.map((m) => {
          // POWER monthly PRECTOTCORR is mm/day average; multiply by ~30 for monthly total
          const baseRainMo = m.precipMm !== null ? Number((m.precipMm * 30).toFixed(1)) : 65;
          const baseTempMo = m.tempMeanC ?? baselineTemp;
          return {
            month: m.label,
            baselineRainMm: baseRainMo,
            scenarioRainMm: Number(Math.max(0, baseRainMo * (1 + params.rainfallChangePct / 100)).toFixed(1)),
            baselineTempC: Number(baseTempMo.toFixed(1)),
            scenarioTempC: Number((baseTempMo + params.tempShiftC).toFixed(1)),
          };
        })
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((mo, idx) => {
          const seasonalFactor = Math.sin(((idx - 2) / 12) * Math.PI * 2) * 0.45 + 0.6;
          const baseRainMo = Number(((baselineRain / 12) * Math.max(0.15, seasonalFactor)).toFixed(1));
          const baseTempMo = Number((baselineTemp + Math.cos((idx / 12) * Math.PI * 2) * 1.8).toFixed(1));
          return {
            month: mo,
            baselineRainMm: baseRainMo,
            scenarioRainMm: Number(Math.max(0, baseRainMo * (1 + params.rainfallChangePct / 100)).toFixed(1)),
            baselineTempC: baseTempMo,
            scenarioTempC: Number((baseTempMo + params.tempShiftC).toFixed(1)),
          };
        });

  const isDryStress = params.rainfallChangePct <= -15 || params.waterAvailabilityDropPct >= 20 || effectiveRainAfterWaterDrop < 600;
  const isHeatStress = params.tempShiftC >= 1.5 || params.extraHeatStressDays >= 10 || simulatedTempC >= 29;
  const isStormErosion = params.extremeRainIntensity !== 'baseline' || params.rainfallChangePct >= 20;

  const outcomes = strategies.map((strat) => {
    if (strat.id === 'strategy_a') {
      return {
        strategyId: strat.id,
        strategyTitle: strat.title,
        projectedWaterBalanceNote: isDryStress
          ? `Simulated effective moisture (${effectiveRainAfterWaterDrop.toFixed(0)} mm) falls short of repeated cereal peak demand, increasing mid-season wilting risk.`
          : `Moisture supply (${effectiveRainAfterWaterDrop.toFixed(0)} mm) remains adequate, though intense storm runoff could leach surface nitrogen.`,
        thermalStressExposure: isHeatStress ? ('High' as const) : ('Moderate' as const),
        moistureVulnerability: isDryStress ? ('High' as const) : ('Moderate' as const),
        erosionExposure: isStormErosion ? ('High' as const) : ('Moderate' as const),
        agronomicSummary:
          isDryStress || isHeatStress
            ? 'Hypothetical stress exposes continuous baseline cropping to simultaneous pollination heat injury, low soil-moisture buffering, and heightened Striga competition.'
            : 'Under milder hypothetical shifts, baseline production persists but continues gradual nutrient drawdown.',
        adaptationActions: [
          'Shift sowing window to avoid peak thermal spike at cereal flowering.',
          'Transition at least one season to a drought-tolerant legume break before stress compounds.',
        ],
      };
    }

    if (strat.id === 'strategy_b') {
      return {
        strategyId: strat.id,
        strategyTitle: strat.title,
        projectedWaterBalanceNote: isDryStress
          ? `Mulch retention and drought-hardy crops buffer ${effectiveRainAfterWaterDrop.toFixed(0)} mm simulated rainfall; cover-crop termination timing must be brought earlier to save moisture.`
          : `Higher simulated moisture (${effectiveRainAfterWaterDrop.toFixed(0)} mm) maximizes cover-crop biomass and nitrogen fixation.`,
        thermalStressExposure: isHeatStress ? ('Moderate' as const) : ('Low' as const),
        moistureVulnerability: isDryStress ? ('Moderate' as const) : ('Low' as const),
        erosionExposure: 'Low' as const,
        agronomicSummary:
          'Hypothetical simulation suggests Strategy B maintains the strongest moisture buffering and soil surface armor under both drought and intense-storm scenarios.',
        adaptationActions: [
          params.rainfallChangePct <= -20
            ? 'Terminate cover crop 2–3 weeks earlier to preserve subsoil water for the succeeding staple.'
            : 'Retain full cover residue on surface to cool soil temperatures and slow storm runoff.',
          'Select short-cycle (65-day) cowpea varieties if rainy-season length contracts.',
        ],
      };
    }

    // Strategy C
    return {
      strategyId: strat.id,
      strategyTitle: strat.title,
      projectedWaterBalanceNote: isDryStress
        ? `Pod-filling cash legumes face moderate yield compression under ${effectiveRainAfterWaterDrop.toFixed(0)} mm simulated effective water unless supplemental water or tied ridges are used.`
        : `Diversified crops capitalize well on ${effectiveRainAfterWaterDrop.toFixed(0)} mm moisture, provided well-drained ridges prevent waterlogging in ${farm.soilTexture} soil.`,
      thermalStressExposure: isHeatStress ? ('Moderate' as const) : ('Low' as const),
      moistureVulnerability: isDryStress ? ('High' as const) : ('Low' as const),
      erosionExposure: isStormErosion ? ('Moderate' as const) : ('Low' as const),
      agronomicSummary:
        'Hypothetical scenario highlights income resilience across multiple crops, with moderate sensitivity to severe dry spells during high-value legume pod fill.',
      adaptationActions: [
        'Use contour ridges or tied-ridging to capture storm bursts for pod-filling legumes.',
        'Keep short-cycle Cowpea or Pigeon Pea ready as a contingency crop if rains arrive late.',
      ],
    };
  });

  return {
    disclaimer:
      'HYPOTHETICAL SCENARIO SIMULATION — NOT A WEATHER FORECAST. Outputs illustrate relative crop-rotation sensitivity to user-adjusted rainfall, temperature, and water stress parameters against your historical NASA POWER baseline.',
    baselineSummary: {
      annualRainMm: env.periodSummary.totalRainMm,
      meanTempC: env.periodSummary.avgTempC,
      simulatedRainMm,
      simulatedTempC,
    },
    monthlyComparison,
    outcomes,
  };
}
