import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, RotateCcw, Sliders } from 'lucide-react';
import { api } from '../lib/api';
import type { ClimateScenarioParams, ClimateScenarioResult, Farm } from '../types';

interface Props {
  farm: Farm;
}

const DEFAULT_PARAMS: ClimateScenarioParams = {
  rainfallChangePct: -15,
  tempShiftC: 1.5,
  extraHeatStressDays: 10,
  waterAvailabilityDropPct: 10,
  extremeRainIntensity: 'moderate',
};

export function ScenarioExplorer({ farm }: Props) {
  const [params, setParams] = useState<ClimateScenarioParams>(DEFAULT_PARAMS);
  const [result, setResult] = useState<ClimateScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await api.simulateScenario(farm.id, params);
        if (active) setResult(res.simulation);
      } catch (err: any) {
        if (active) setError(err.message);
      } finally {
        if (active) setLoading(false);
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [farm.id, params]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#132A20]">
            Hypothetical Climate Scenario Explorer
          </h2>
          <p className="text-sm text-[#47564E] mt-1">
            Stress-test your 3 crop-rotation strategies against hypothetical rainfall, heat, and water availability shifts relative to your NASA POWER baseline.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setParams({ rainfallChangePct: -25, tempShiftC: 1.5, extraHeatStressDays: 12, waterAvailabilityDropPct: 25, extremeRainIntensity: 'baseline' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8D2C3] bg-white hover:border-[#0E4D3A]"
          >
            Dry Spell Stress
          </button>
          <button
            type="button"
            onClick={() => setParams({ rainfallChangePct: 0, tempShiftC: 2.5, extraHeatStressDays: 20, waterAvailabilityDropPct: 15, extremeRainIntensity: 'moderate' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8D2C3] bg-white hover:border-[#0E4D3A]"
          >
            Heat Wave (+2.5°C)
          </button>
          <button
            type="button"
            onClick={() => setParams({ rainfallChangePct: 30, tempShiftC: 0.5, extraHeatStressDays: 0, waterAvailabilityDropPct: 0, extremeRainIntensity: 'severe' })}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8D2C3] bg-white hover:border-[#0E4D3A]"
          >
            Intense Storms (+30%)
          </button>
          <button
            type="button"
            onClick={() => setParams(DEFAULT_PARAMS)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8D2C3] text-[#5E6D64] hover:text-[#132A20]"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </div>

      {/* Mandatory Hypothetical Simulation Notice */}
      <div className="bg-[#FDF8EE] border border-[#E6D2A2] rounded-xl px-4 py-3 flex items-start gap-3 text-xs text-[#6B470D]">
        <AlertTriangle className="w-4 h-4 text-[#B8862D] shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold">Hypothetical Scenario Simulation — Not a Weather Forecast: </span>
          Adjusting these controls explores how different rotation designs respond under hypothetical climate stress relative to your farm’s historical NASA POWER observations.
        </div>
      </div>

      {/* Controls + Summary Split */}
      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#132A20] border-b border-[#ECE8DD] pb-3">
            <Sliders className="w-4 h-4 text-[#0E4D3A]" />
            <span>Scenario Parameters</span>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between font-medium mb-1">
                <span>Seasonal Rainfall Shift</span>
                <span className="font-mono text-[#0E4D3A] font-semibold">
                  {params.rainfallChangePct >= 0 ? `+${params.rainfallChangePct}%` : `${params.rainfallChangePct}%`}
                </span>
              </div>
              <input
                type="range"
                min={-40}
                max={40}
                step={5}
                value={params.rainfallChangePct}
                onChange={(e) => setParams({ ...params, rainfallChangePct: Number(e.target.value) })}
                className="w-full accent-[#0E4D3A]"
              />
              <div className="flex justify-between text-[11px] text-[#6E7C73]">
                <span>-40% Drought</span>
                <span>0% Baseline</span>
                <span>+40% Wetter</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between font-medium mb-1">
                <span>Mean Temperature Increase</span>
                <span className="font-mono text-[#B8862D] font-semibold">+{params.tempShiftC.toFixed(1)} °C</span>
              </div>
              <input
                type="range"
                min={0}
                max={3.5}
                step={0.5}
                value={params.tempShiftC}
                onChange={(e) => setParams({ ...params, tempShiftC: Number(e.target.value) })}
                className="w-full accent-[#B8862D]"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium mb-1">
                <span>Additional Heat-Stress Days (≥35°C)</span>
                <span className="font-mono text-[#9E2F1B] font-semibold">+{params.extraHeatStressDays} days</span>
              </div>
              <input
                type="range"
                min={0}
                max={30}
                step={2}
                value={params.extraHeatStressDays}
                onChange={(e) => setParams({ ...params, extraHeatStressDays: Number(e.target.value) })}
                className="w-full accent-[#9E2F1B]"
              />
            </div>

            <div>
              <div className="flex justify-between font-medium mb-1">
                <span>Effective Water Availability Drop</span>
                <span className="font-mono text-[#132A20] font-semibold">-{params.waterAvailabilityDropPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={5}
                value={params.waterAvailabilityDropPct}
                onChange={(e) => setParams({ ...params, waterAvailabilityDropPct: Number(e.target.value) })}
                className="w-full accent-[#0E4D3A]"
              />
            </div>

            <div>
              <label className="block font-medium mb-1.5">Extreme Precipitation Frequency</label>
              <div className="grid grid-cols-3 gap-1 p-1 bg-[#F2EFE7] rounded-lg">
                {(['baseline', 'moderate', 'severe'] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setParams({ ...params, extremeRainIntensity: lvl })}
                    className={`py-1.5 rounded text-xs font-medium capitalize ${
                      params.extremeRainIntensity === lvl ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {result && (
            <div className="pt-3 border-t border-[#ECE8DD] grid grid-cols-2 gap-3 text-xs">
              <div className="bg-[#FAF8F3] p-2.5 rounded-lg border border-[#ECE8DD]">
                <div className="text-[#5E6D64]">Simulated Rain</div>
                <div className="font-mono text-base font-semibold text-[#132A20]">
                  {result.baselineSummary.simulatedRainMm ?? 'N/A'} mm
                </div>
                <div className="text-[11px] text-[#5E6D64]">vs {result.baselineSummary.annualRainMm ?? 'N/A'} mm base</div>
              </div>
              <div className="bg-[#FAF8F3] p-2.5 rounded-lg border border-[#ECE8DD]">
                <div className="text-[#5E6D64]">Simulated Temp</div>
                <div className="font-mono text-base font-semibold text-[#132A20]">
                  {result.baselineSummary.simulatedTempC ?? 'N/A'} °C
                </div>
                <div className="text-[11px] text-[#5E6D64]">vs {result.baselineSummary.meanTempC ?? 'N/A'} °C base</div>
              </div>
            </div>
          )}
        </div>

        {/* Charts */}
        <div className="lg:col-span-8 space-y-5">
          {error && <div className="p-3 bg-[#FDF2F0] border border-[#E5B8B0] rounded-lg text-xs text-[#8C2D19]">{error}</div>}
          {result && (
            <div className="grid md:grid-cols-2 gap-5">
              <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
                <h3 className="text-xs font-semibold text-[#132A20] mb-3">
                  Monthly Rainfall: Historical vs Hypothetical (mm)
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={result.monthlyComparison}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="baselineRainMm" name="Baseline (mm)" fill="#A3B8AC" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="scenarioRainMm" name="Scenario (mm)" fill="#0E4D3A" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
                <h3 className="text-xs font-semibold text-[#132A20] mb-3">
                  Monthly Temperature: Historical vs Hypothetical (°C)
                </h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={result.monthlyComparison}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                      <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="baselineTempC" name="Baseline (°C)" stroke="#5A665E" strokeWidth={1.6} dot={false} />
                      <Line type="monotone" dataKey="scenarioTempC" name="Scenario (°C)" stroke="#B8862D" strokeWidth={2.2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* Strategy Vulnerability Outcomes */}
          {result && (
            <div className="grid md:grid-cols-3 gap-4">
              {result.outcomes.map((o) => (
                <div key={o.strategyId} className={`bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-3 ${loading ? 'opacity-70' : ''}`}>
                  <div>
                    <div className="text-xs font-semibold text-[#0E4D3A]">{o.strategyTitle}</div>
                    <p className="text-xs text-[#47564E] mt-1 leading-relaxed">{o.agronomicSummary}</p>
                  </div>

                  <div className="space-y-1.5 text-xs bg-[#FAF8F3] border border-[#ECE8DD] rounded-lg p-2.5">
                    <div className="flex justify-between">
                      <span className="text-[#5E6D64]">Moisture Vulnerability</span>
                      <span className={o.moistureVulnerability === 'High' ? 'text-[#9E2F1B] font-semibold' : o.moistureVulnerability === 'Moderate' ? 'text-[#9A6A16] font-semibold' : 'text-[#0E4D3A] font-semibold'}>
                        {o.moistureVulnerability}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#5E6D64]">Thermal Exposure</span>
                      <span className={o.thermalStressExposure === 'High' ? 'text-[#9E2F1B] font-semibold' : o.thermalStressExposure === 'Moderate' ? 'text-[#9A6A16] font-semibold' : 'text-[#0E4D3A] font-semibold'}>
                        {o.thermalStressExposure}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#5E6D64]">Erosion Exposure</span>
                      <span className={o.erosionExposure === 'High' ? 'text-[#9E2F1B] font-semibold' : o.erosionExposure === 'Moderate' ? 'text-[#9A6A16] font-semibold' : 'text-[#0E4D3A] font-semibold'}>
                        {o.erosionExposure}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-[#44544B]">{o.projectedWaterBalanceNote}</p>

                  <div className="pt-1 border-t border-[#ECE8DD]">
                    <div className="text-[11px] font-semibold text-[#132A20] mb-1">Suggested Adjustments</div>
                    <ul className="list-disc pl-4 space-y-1 text-[11px] text-[#47564E]">
                      {o.adaptationActions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
