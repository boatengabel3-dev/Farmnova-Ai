import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { db } from './db.ts';
import type { ChatMessage, EnvironmentalAnalysis, Farm, RotationStrategy } from '../src/types.ts';

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function askAgriAssistant(
  farm: Farm,
  env: EnvironmentalAnalysis,
  strategies: RotationStrategy[],
  history: ChatMessage[],
  userQuestion: string
): Promise<{ answer: string; modelUsed: string }> {
  const aiSettings = db.prepare(`SELECT * FROM ai_settings WHERE id = 'default'`).get() as
    | {
        model_name: string;
        system_tone: string;
        strict_scientific_disclaimer: number;
        max_history_turns: number;
      }
    | undefined;

  const modelName = aiSettings?.model_name || 'gemini-4-hydrogen';
  const tone = aiSettings?.system_tone || 'Practical, respectful agronomic advisor grounded in empirical observation';
  const strictDisclaimer = aiSettings ? Boolean(aiSettings.strict_scientific_disclaimer) : true;
  const maxTurns = aiSettings?.max_history_turns ?? 12;

  const ai = getAiClient();
  if (!ai) {
    throw new Error(
      'Gemini API key is not configured on the server. Please configure GEMINI_API_KEY in Settings > Secrets to enable the AI Agricultural Assistant.'
    );
  }

  const missingDataList = [
    farm.soilPh === null ? 'Soil pH (unknown)' : `Soil pH: ${farm.soilPh}`,
    farm.organicMatterPct === null ? 'Soil organic matter % (unknown)' : `Organic matter: ${farm.organicMatterPct}%`,
    `Soil fertility reported: ${farm.soilFertility}`,
  ].join('; ');

  const systemInstruction = `You are TerraVane's Agricultural Intelligence Assistant.
Tone: ${tone}.
Target Audience: Farmers and local agricultural extension staff—use clear, practical, non-jargon language while remaining scientifically rigorous.

STRICT SCIENTIFIC TRANSPARENCY RULES:
1. NEVER invent or guess satellite measurements, NDVI values, yields, or weather figures not explicitly provided in the Farm & NASA Context below.
2. Always distinguish between:
   - Direct satellite/meteorological observations (e.g., NASA POWER precipitation/temperature, SRTM elevation)
   - Derived indicators (e.g., FAO-56 ET0 water balance, moisture anomalies)
   - Expert-validated agronomic knowledge (e.g., legume nitrogen fixation, Striga host interruption)
   - Local unknowns requiring field or lab testing.
3. Explicitly note spatial resolution limits when discussing satellite data (e.g., NASA POWER is 0.5° / ~55 km regional grid; GRACE is ~300 km basin context and NOT field soil moisture).
4. Support the farmer's judgment and recommend consulting local extension agronomists before major capital commitments.
${strictDisclaimer ? '5. End or weave in a brief note identifying what local information is still missing before finalizing a field decision if gaps exist.' : ''}

REGISTERED FARM CONTEXT:
- Farm Name: ${farm.name} (${farm.sizeHectares} ha, ${farm.farmingType})
- Location: ${farm.district}, ${farm.region}, ${farm.country} (Centroid: ${farm.centroidLat.toFixed(4)}, ${farm.centroidLon.toFixed(4)})
- Soil Profile: ${farm.soilType}, Texture: ${farm.soilTexture}, Drainage: ${farm.drainage}, Irrigation: ${farm.irrigationAvailable}
- Soil Measurement Gaps / Knowns: ${missingDataList}
- Previous Crops: ${farm.previousCrops.join(', ') || 'None recorded'}
- Current Crops: ${farm.currentCrops.join(', ') || 'None recorded'}
- Planned Crops: ${farm.plannedCrops.join(', ') || 'None recorded'}
- Planting Seasons: ${farm.plantingSeasons} | Harvest: ${farm.harvestPeriods}
- Pest & Disease History: ${farm.pestHistory || 'None reported'}
- Farmer Priorities: ${farm.priorities.join(', ') || 'General resilience'}

LIVE NASA EARTH OBSERVATION & TERRAIN SUMMARY (${env.periodSummary.startDate} to ${env.periodSummary.endDate}):
- SRTM Elevation: ${env.elevationMeters !== null ? `${env.elevationMeters} m` : 'Unavailable'} | Estimated Slope: ${env.terrainSlopePct !== null ? `${env.terrainSlopePct}%` : 'Unavailable'}
- Total Observed Precipitation (NASA POWER/GPM heritage): ${env.periodSummary.totalRainMm !== null ? `${env.periodSummary.totalRainMm} mm` : 'Unavailable'}
- Longest Dry Spell (<1mm/day): ${env.periodSummary.longestDrySpellDays} days | Heavy Rain Days (>=30mm): ${env.periodSummary.extremeRainDaysAbove30Mm}
- Mean 2m Temperature: ${env.periodSummary.avgTempC !== null ? `${env.periodSummary.avgTempC} °C` : 'Unavailable'} | Max Observed: ${env.periodSummary.maxTempObservedC !== null ? `${env.periodSummary.maxTempObservedC} °C` : 'N/A'} | Heat Stress Days (>=35°C): ${env.periodSummary.heatStressDaysAbove35C}
- Root-Zone Soil Wetness Index (0-1 assimilated): ${env.periodSummary.avgRootSoilWetness ?? 'Unavailable'} (90-day anomaly vs 5-yr baseline: ${env.periodSummary.soilMoistureAnomalyPct !== null ? `${env.periodSummary.soilMoistureAnomalyPct}%` : 'N/A'})
- Estimated Annual Reference ET0: ${env.periodSummary.estimatedAnnualEt0Mm !== null ? `${env.periodSummary.estimatedAnnualEt0Mm} mm` : 'Unavailable'} | Climatic Water Balance: ${env.periodSummary.waterBalanceMm !== null ? `${env.periodSummary.waterBalanceMm} mm` : 'N/A'}
- Vegetation Context: ${env.periodSummary.ndviProxyContext}

GENERATED CROP ROTATION STRATEGIES:
${strategies
  .map(
    (s) => `${s.label} — ${s.title}: ${s.subtitle}
  Steps: ${s.steps.map((st) => `${st.seasonLabel}: ${st.cropName} (${st.durationDays})`).join(' | ')}
  Nutrient Cycling: ${s.nutrientCycling}
  Water: ${s.waterRequirements}
  Risks: ${s.environmentalRisks.join(' ')}
  Missing Info: ${s.missingInformation.join(' ')}`
  )
  .join('\n\n')}`;

  const recentTurns = history.slice(-maxTurns);
  const formattedHistory = recentTurns
    .map((m) => `${m.role === 'user' ? 'Farmer' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const prompt = formattedHistory
    ? `Previous conversation:\n${formattedHistory}\n\nFarmer's new question: ${userQuestion}`
    : `Farmer's question: ${userQuestion}`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const answer = (response.text ?? '').trim();
  if (!answer) {
    throw new Error('The AI assistant returned an empty response. Please try rephrasing your question.');
  }

  return { answer, modelUsed: modelName };
}
