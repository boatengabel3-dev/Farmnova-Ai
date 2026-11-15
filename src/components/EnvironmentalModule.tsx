import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import type { EnvironmentalAnalysis } from '../types';

interface Props {
  analysis: EnvironmentalAnalysis;
  onRefresh: () => void;
  refreshing: boolean;
}

export function EnvironmentalModule({ analysis, onRefresh, refreshing }: Props) {
  const [windowRange, setWindowRange] = useState<'90d' | '180d' | '365d'>('180d');

  const slicedDaily = useMemo(() => {
    const count = windowRange === '90d' ? 90 : windowRange === '180d' ? 180 : 365;
    return analysis.dailySeries.slice(-count).map((d) => ({
      ...d,
      shortDate: d.date.slice(5),
      smTopPct: d.soilMoistureTop !== null ? Number((d.soilMoistureTop * 100).toFixed(1)) : null,
      smRootPct: d.soilMoistureRoot !== null ? Number((d.soilMoistureRoot * 100).toFixed(1)) : null,
    }));
  }, [analysis.dailySeries, windowRange]);

  const monthlyChartData = useMemo(() => {
    return analysis.monthlySeries.slice(-24).map((m) => ({
      ...m,
      monthlyRainApproxMm: m.precipMm !== null ? Number((m.precipMm * 30).toFixed(0)) : null,
      smRootPct: m.soilMoistureRoot !== null ? Number((m.soilMoistureRoot * 100).toFixed(1)) : null,
    }));
  }, [analysis.monthlySeries]);

  return (
    <div className="space-y-8">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#132A20]">
            Environmental Intelligence & NASA Observations
          </h2>
          <p className="text-sm text-[#47564E] mt-1">
            Live NASA POWER agroclimatology, GPM precipitation heritage, SMAP assimilated soil wetness, and SRTM terrain data for{' '}
            <span className="font-mono text-xs text-[#132A20]">
              {analysis.coordinates.lat.toFixed(4)}°, {analysis.coordinates.lon.toFixed(4)}°
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-[#EAE4D7] rounded-lg text-xs">
            {(['90d', '180d', '365d'] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowRange(w)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  windowRange === w ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
                }`}
              >
                {w === '90d' ? '90 Days' : w === '180d' ? '6 Months' : '12 Months'}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-[#D8D2C3] bg-white text-[#132A20] hover:border-[#0E4D3A] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Fetching NASA...' : 'Refresh Satellite Data'}
          </button>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Rainfall & Derived ET0 */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-[#132A20]">Daily Rainfall vs Reference Evapotranspiration (ET₀)</h3>
            <span className="text-xs font-mono text-[#5E6D64]">mm / day</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            Bars show NASA POWER / GPM-corrected precipitation; dashed amber line shows Penman-Monteith derived atmospheric water demand.
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={slicedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={22} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }}
                />
                <Bar dataKey="precipMm" name="Rainfall (mm)" fill="#0E4D3A" radius={[2, 2, 0, 0]} />
                <Line type="monotone" dataKey="et0Mm" name="Derived ET0 (mm)" stroke="#B8862D" strokeWidth={1.8} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Temperature & Heat Stress */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-[#132A20]">2-Meter Air Temperature & Heat-Stress Threshold</h3>
            <span className="text-xs font-mono text-[#5E6D64]">°C</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            Daily maximum and mean air temperature. The 35 °C threshold indicates elevated pollination heat stress for maize and sensitive legumes.
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={slicedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={22} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <ReferenceLine y={35} stroke="#B93822" strokeDasharray="4 4" label={{ value: '35°C Stress', fontSize: 10, fill: '#B93822', position: 'insideTopRight' }} />
                <Area type="monotone" dataKey="tempMaxC" name="Daily Max (°C)" stroke="#B8862D" fill="#B8862D" fillOpacity={0.14} strokeWidth={1.6} />
                <Line type="monotone" dataKey="tempMeanC" name="Daily Mean (°C)" stroke="#132A20" strokeWidth={1.6} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Soil Wetness Profile */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-[#132A20]">Assimilated Surface & Root-Zone Soil Wetness</h3>
            <span className="text-xs font-mono text-[#5E6D64]">% Saturation Index</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            Regional wetness index (0–100%) from NASA POWER / SMAP assimilation. Represents multi-kilometer moisture dynamics, not plot soil texture.
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={slicedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={22} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <Area type="monotone" dataKey="smRootPct" name="Root-Zone (0–100 cm) %" stroke="#0E4D3A" fill="#0E4D3A" fillOpacity={0.16} strokeWidth={2} />
                <Line type="monotone" dataKey="smTopPct" name="Surface (0–5 cm) %" stroke="#4F7F6D" strokeWidth={1.4} strokeDasharray="3 3" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Multi-Year Monthly Historical Rainfall */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="text-sm font-semibold text-[#132A20]">24-Month Historical Rainfall & Seasonal Transitions</h3>
            <span className="text-xs font-mono text-[#5E6D64]">mm / month</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            Multi-year monthly baseline illustrating wet-to-dry transitions and inter-annual rainfall shifts across recent seasons.
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={14} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <Bar dataKey="monthlyRainApproxMm" name="Est. Monthly Rain (mm)" fill="#176B4F" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Scientific Transparency Insights */}
      <div>
        <h3 className="font-display text-xl font-semibold text-[#132A20] mb-1">
          Interpreted Environmental Findings & Uncertainty Boundaries
        </h3>
        <p className="text-sm text-[#47564E] mb-4">
          Each finding separates direct satellite/gridded observations from agronomic interpretation and states what local checks remain necessary.
        </p>

        <div className="grid md:grid-cols-2 gap-5">
          {analysis.insights.map((ins) => (
            <div key={ins.id} className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[#5E6D64] font-medium">
                    {ins.category} · {ins.observationType}
                  </div>
                  <h4 className="text-base font-semibold text-[#132A20] mt-0.5">{ins.title}</h4>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold whitespace-nowrap ${
                    ins.statusLevel === 'Nominal'
                      ? 'text-[#0E4D3A]'
                      : ins.statusLevel === 'Watch'
                      ? 'text-[#9A6A16]'
                      : 'text-[#9E2F1B]'
                  }`}
                >
                  {ins.statusLevel === 'Nominal' ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : ins.statusLevel === 'Watch' ? (
                    <Info className="w-3.5 h-3.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {ins.statusLevel}
                </span>
              </div>

              <div className="space-y-2 text-xs leading-relaxed text-[#33423A]">
                <div>
                  <span className="font-semibold text-[#132A20]">What was observed ({ins.whenObserved}): </span>
                  {ins.whatWasObserved}
                </div>
                <div>
                  <span className="font-semibold text-[#132A20]">What it could mean: </span>
                  {ins.whatItCouldMean}
                </div>
                <div className="pt-1 border-t border-[#F0ECE2] text-[#5E6D64]">
                  <span className="font-semibold text-[#2E3E35]">What it cannot establish: </span>
                  {ins.whatItCannotEstablish}
                </div>
                <div className="text-[#0E4D3A]">
                  <span className="font-semibold">Additional local info needed: </span>
                  {ins.additionalInfoNeeded}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NASA Dataset Provenance & Harmonisation Table */}
      <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2DDD1] bg-[#FAF8F3]">
          <h3 className="font-display text-lg font-semibold text-[#132A20]">
            NASA Earth Observation Provenance & Harmonisation Ledger
          </h3>
          <p className="text-xs text-[#5E6D64] mt-0.5">
            Transparent audit of every satellite and gridded dataset integrated for your farm, including spatial resolution, missing records, and scientific limitations.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2DDD1] bg-[#F2EFE7]/70 text-[#2E3E35]">
                <th className="py-3 px-4 font-semibold">Mission / Dataset</th>
                <th className="py-3 px-4 font-semibold">Observation Date / Window</th>
                <th className="py-3 px-4 font-semibold">Spatial & Temporal Res.</th>
                <th className="py-3 px-4 font-semibold">Quality & Missing</th>
                <th className="py-3 px-4 font-semibold">Processing & Limitations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE8DD]">
              {analysis.datasets.map((ds) => (
                <tr key={ds.id} className="hover:bg-[#FAF8F3]/70 align-top">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#132A20]">{ds.missionCode}</div>
                    <div className="text-[#47564E]">{ds.datasetName}</div>
                    <div className="text-[11px] text-[#6E7C73] mt-0.5">{ds.dataSource}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[#2E3E35] whitespace-nowrap">{ds.observationDate}</td>
                  <td className="py-3 px-4">
                    <div className="font-mono text-[#132A20]">{ds.spatialResolution}</div>
                    <div className="text-[#5E6D64] mt-0.5">{ds.temporalResolution}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div
                      className={`font-semibold ${
                        ds.dataQuality === 'Verified Live'
                          ? 'text-[#0E4D3A]'
                          : ds.dataQuality === 'Regional Context'
                          ? 'text-[#8A621C]'
                          : 'text-[#9E2F1B]'
                      }`}
                    >
                      {ds.dataQuality}
                    </div>
                    <div className="font-mono text-[11px] text-[#5E6D64] mt-0.5">
                      Missing obs: {ds.missingObservations}
                    </div>
                  </td>
                  <td className="py-3 px-4 max-w-md space-y-1 text-[#3B4A42]">
                    <div>
                      <span className="font-medium text-[#132A20]">Method: </span>
                      {ds.processingMethod}
                    </div>
                    <div className="text-[#6B3A2C]">
                      <span className="font-medium">Limitation: </span>
                      {ds.limitations}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
