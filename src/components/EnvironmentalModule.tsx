import React, { useEffect, useMemo, useState } from 'react';
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
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cloud,
  CloudLightning,
  CloudRain,
  Droplets,
  Info,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sun,
  ThermometerSun,
  Wind,
} from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type { EnvironmentalAnalysis, FarmHazard, WeatherApiComparison } from '../types';

interface Props {
  analysis: EnvironmentalAnalysis;
  onRefresh: () => void;
  refreshing: boolean;
}

type DataSourceView = 'power' | 'weather' | 'both';

function WeatherConditionIcon({ code, className = 'w-5 h-5' }: { code: number | null; className?: string }) {
  if (code === null) return <Cloud className={`${className} text-[#5E6D64]`} />;
  if (code >= 95) return <CloudLightning className={`${className} text-[#B93822]`} />;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return <CloudRain className={`${className} text-[#0E4D3A]`} />;
  }
  if (code === 0 || code === 1) return <Sun className={`${className} text-[#B8862D]`} />;
  return <Cloud className={`${className} text-[#5E6D64]`} />;
}

function describeLast30RainPlain(rain30Mm: number | null): string {
  if (rain30Mm === null) {
    return 'Recent 30-day rainfall data is currently missing from this satellite window (missing values are not estimated).';
  }
  if (rain30Mm < 20) {
    return `Only ${rain30Mm} mm fell over the last 30 days — dry topsoil conditions; delay unprotected dry sowing until soaking rain arrives.`;
  }
  if (rain30Mm < 80) {
    return `${rain30Mm} mm of rain over the last 30 days gives light-to-moderate moisture; mulch and early weeding help keep water around roots.`;
  }
  return `${rain30Mm} mm of rain in the last 30 days provides strong moisture recharge; check field drains so water does not pool.`;
}

function describeRainPlain(totalRainMm: number | null, longestDrySpellDays: number): { label: string; note: string; tone: string } {
  if (totalRainMm === null) {
    return {
      label: 'Data Missing',
      note: 'Rainfall satellite records are currently missing for this plot (missing gaps are kept blank).',
      tone: 'text-[#5E6D64]',
    };
  }
  if (totalRainMm < 250) {
    return {
      label: 'Dry Conditions',
      note: `${totalRainMm} mm of rain across the 180-day window with gaps up to ${longestDrySpellDays} dry days. Choose drought-hardy crops and hold moisture with mulch.`,
      tone: 'text-[#9E2F1B]',
    };
  }
  if (totalRainMm <= 700) {
    return {
      label: 'Moderate Rain',
      note: `${totalRainMm} mm of rain across the 180-day window (longest dry break: ${longestDrySpellDays} days). Suitable for rotating cereals with legumes if planted on time.`,
      tone: 'text-[#0E4D3A]',
    };
  }
  return {
    label: 'High Rainfall',
    note: `${totalRainMm} mm of rain across the 180-day window. Plentiful moisture, so keep field drains clear and protect bare soil from washout.`,
    tone: 'text-[#0E4D3A]',
  };
}

function describeHeatPlain(avgTempC: number | null, heatDays: number, maxTemp: number | null): { label: string; note: string; tone: string } {
  if (avgTempC === null) {
    return { label: 'Data Missing', note: 'Temperature readings are missing for this window.', tone: 'text-[#5E6D64]' };
  }
  if (heatDays >= 15 || (maxTemp !== null && maxTemp >= 38)) {
    return {
      label: 'Hot & Heat-Stress Prone',
      note: `Typical warmth is ${avgTempC}°C with ${heatDays} very hot days (35°C+). High afternoon heat can stress flowering maize; early planting helps.`,
      tone: 'text-[#9E2F1B]',
    };
  }
  if (heatDays >= 5) {
    return {
      label: 'Warm With Hot Spells',
      note: `Average temperature is ${avgTempC}°C (up to ${maxTemp ?? '—'}°C), with ${heatDays} hot days where young crops benefit from ground cover.`,
      tone: 'text-[#9A6A16]',
    };
  }
  return {
    label: 'Mild to Warm',
    note: `Average temperature is ${avgTempC}°C with low extreme heat (${heatDays} days ≥35°C), favorable for steady crop growth.`,
    tone: 'text-[#0E4D3A]',
  };
}

function describeSoilPlain(rootWetness: number | null, anomalyPct: number | null): { label: string; pct: number | null; note: string; tone: string } {
  if (rootWetness === null) {
    return { label: 'Data Missing', pct: null, note: 'Root-zone soil wetness index is missing for this window.', tone: 'text-[#5E6D64]' };
  }
  const pct = Number((rootWetness * 100).toFixed(0));
  const trendNote =
    anomalyPct !== null
      ? anomalyPct < -8
        ? `This is ${Math.abs(anomalyPct)}% drier than the 10-year monthly norm.`
        : anomalyPct > 8
        ? `This is ${anomalyPct}% wetter than the 10-year monthly norm.`
        : 'This aligns with the historical seasonal norm.'
      : '';
  if (pct < 40) {
    return {
      label: `Low Moisture (${pct}%)`,
      pct,
      note: `Deeper soil (0–100 cm) is relatively dry (${pct}%). Wait for soaking rain before planting or use water-saving ridges. ${trendNote}`,
      tone: 'text-[#9E2F1B]',
    };
  }
  if (pct <= 70) {
    return {
      label: `Healthy Moisture (${pct}%)`,
      pct,
      note: `Soil down to 1 meter holds ${pct}% wetness — supportive for root growth and planting after rain onset. ${trendNote}`,
      tone: 'text-[#0E4D3A]',
    };
  }
  return {
    label: `Very Wet Soil (${pct}%)`,
    pct,
    note: `Soil holds ${pct}% wetness. Watch low-lying pockets for standing water or root rot after storms. ${trendNote}`,
    tone: 'text-[#9A6A16]',
  };
}

function describeSlopePlain(slopePct: number | null, elevationM: number | null): { label: string; note: string; tone: string } {
  if (slopePct === null) {
    return { label: 'Slope Unknown', note: 'Check your land in person for rainwater runoff channels.', tone: 'text-[#5E6D64]' };
  }
  if (slopePct < 2) {
    return {
      label: `Flat / Gentle (${slopePct}%)`,
      note: `Elevation ${elevationM ?? '—'} m above sea level with gentle slope (${slopePct}%). Rain soaks in easily with low erosion risk.`,
      tone: 'text-[#0E4D3A]',
    };
  }
  if (slopePct < 6) {
    return {
      label: `Rolling Slope (${slopePct}%)`,
      note: `Elevation ${elevationM ?? '—'} m with moderate slope (${slopePct}%). Plant across the slope and keep crop mulch to slow soil washout.`,
      tone: 'text-[#9A6A16]',
    };
  }
  return {
    label: `Steep Slope (${slopePct}%)`,
    note: `Steeper terrain (${slopePct}%) washes soil fast in storms. Use contour ridges, grass strips, or terracing.`,
    tone: 'text-[#9E2F1B]',
  };
}

function severityStyles(severity: FarmHazard['severity']) {
  switch (severity) {
    case 'Severe':
      return { card: 'bg-[#FDF2F0] border-[#D98C7E]', badge: 'text-[#8C2D19]' };
    case 'High':
      return { card: 'bg-[#FDF6EE] border-[#E3B47A]', badge: 'text-[#9E2F1B]' };
    case 'Moderate':
      return { card: 'bg-[#FDF8EE] border-[#E8D5A7]', badge: 'text-[#9A6A16]' };
    default:
      return { card: 'bg-[#F4F8F6] border-[#C5DDD2]', badge: 'text-[#0E4D3A]' };
  }
}

function pctDiscrepancy(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom < 1) return null;
  return Number(((Math.abs(a - b) / denom) * 100).toFixed(1));
}

export function EnvironmentalModule({ analysis, onRefresh, refreshing }: Props) {
  const { t } = useI18n();
  const [windowRange, setWindowRange] = useState<'30d' | '90d' | '180d'>('180d');
  const [viewMode, setViewMode] = useState<'simple' | 'technical'>('simple');
  const [dataSource, setDataSource] = useState<DataSourceView>('both');
  const [edgeWeather, setEdgeWeather] = useState<WeatherApiComparison | null>(null);
  const [edgeLoading, setEdgeLoading] = useState(false);

  // Call ONLY the Supabase Edge Function for the meteorological weather API comparison
  useEffect(() => {
    let active = true;
    setEdgeLoading(true);
    api
      .getEdgeWeatherObservations(analysis.coordinates.lat, analysis.coordinates.lon, 30)
      .then((res) => {
        if (active) setEdgeWeather(res);
      })
      .finally(() => {
        if (active) setEdgeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [analysis.coordinates.lat, analysis.coordinates.lon, analysis.fetchedAt]);

  const slicedDaily = useMemo(() => {
    const count = windowRange === '30d' ? 30 : windowRange === '90d' ? 90 : 180;
    return analysis.dailySeries.slice(-count).map((d) => ({
      ...d,
      shortDate: d.date.slice(5),
      smTopPct: d.soilMoistureTop !== null ? Number((d.soilMoistureTop * 100).toFixed(1)) : null,
      smRootPct: d.soilMoistureRoot !== null ? Number((d.soilMoistureRoot * 100).toFixed(1)) : null,
    }));
  }, [analysis.dailySeries, windowRange]);

  // Align last 30 days between NASA POWER and Edge Weather API for side-by-side chart
  const sideBySide30 = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        shortDate: string;
        powerRain: number | null;
        weatherRain: number | null;
        powerTemp: number | null;
        weatherTemp: number | null;
      }
    >();

    for (const d of analysis.dailySeries.slice(-30)) {
      byDate.set(d.date, {
        date: d.date,
        shortDate: d.date.slice(5),
        powerRain: d.precipMm,
        weatherRain: null,
        powerTemp: d.tempMeanC,
        weatherTemp: null,
      });
    }

    if (edgeWeather?.connected && Array.isArray(edgeWeather.daily)) {
      for (const w of edgeWeather.daily) {
        const existing = byDate.get(w.date) || {
          date: w.date,
          shortDate: w.date.slice(5),
          powerRain: null,
          weatherRain: null,
          powerTemp: null,
          weatherTemp: null,
        };
        existing.weatherRain = w.precipMm;
        existing.weatherTemp = w.tempMeanC;
        byDate.set(w.date, existing);
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [analysis.dailySeries, edgeWeather]);

  const rainPlain = describeRainPlain(analysis.periodSummary.totalRainMm, analysis.periodSummary.longestDrySpellDays);
  const heatPlain = describeHeatPlain(
    analysis.periodSummary.avgTempC,
    analysis.periodSummary.heatStressDaysAbove35C,
    analysis.periodSummary.maxTempObservedC
  );
  const soilPlain = describeSoilPlain(
    analysis.periodSummary.avgRootSoilWetness,
    analysis.periodSummary.soilMoistureAnomalyPct
  );
  const slopePlain = describeSlopePlain(analysis.terrainSlopePct, analysis.elevationMeters);

  const forecast = analysis.realtimeForecast;
  const hazards = analysis.hazards ?? [];
  const climo10Yr = analysis.climatology10Yr ?? [];

  const powerRain30 = analysis.periodSummary.last30DaysRainMm ?? null;
  const powerTemp30 = analysis.periodSummary.last30DaysAvgTempC ?? null;
  const wxRain30 = edgeWeather?.connected ? edgeWeather.last30DaysRainMm : null;
  const wxTemp30 = edgeWeather?.connected ? edgeWeather.last30DaysAvgTempC : null;

  const rainDiffPct = pctDiscrepancy(powerRain30, wxRain30);
  const tempDiffPct = pctDiscrepancy(powerTemp30, wxTemp30);
  const sourcesDisagreeOver20Pct =
    (rainDiffPct !== null && rainDiffPct > 20) || (tempDiffPct !== null && tempDiffPct > 20);

  return (
    <div className="space-y-8">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#132A20]">{t('env.title')}</h2>
          <p className="text-sm text-[#47564E] mt-1">
            {t('env.subtitle')}{' '}
            <span className="font-mono text-xs text-[#132A20]">
              {analysis.coordinates.lat.toFixed(4)}°, {analysis.coordinates.lon.toFixed(4)}°
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-[#5E6D64]">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#0E4D3A]" />
              Last available NASA POWER date:{' '}
              <strong className="font-mono text-[#132A20]">
                {analysis.lastAvailableDate ?? 'Unavailable'}
              </strong>{' '}
              <span className="text-[11px]">(satellite records typically lag 2–6 days)</span>
            </span>
            {analysis.cacheHit && (
              <span className="text-[11px] font-medium text-[#0E4D3A]">· Loaded from per-farm cache</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Plain Language vs Technical View Switch */}
          <div className="flex items-center gap-1 p-1 bg-[#EAE4D7] rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setViewMode('simple')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                viewMode === 'simple' ? 'bg-white text-[#0E4D3A] shadow-xs' : 'text-[#5A665E]'
              }`}
            >
              {t('env.simpleMode')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('technical')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                viewMode === 'technical' ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
              }`}
            >
              {t('env.techMode')}
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#EAE4D7] rounded-lg text-xs">
            {(['30d', '90d', '180d'] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWindowRange(w)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  windowRange === w ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
                }`}
              >
                {w === '30d' ? '30 Days' : w === '90d' ? '90 Days' : '180 Days'}
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
            {refreshing ? t('env.refreshing') : t('env.refresh')}
          </button>
        </div>
      </div>

      {/* Data Source Selector & 30-Day Side-by-Side Comparison */}
      <div className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-[#ECE8DD]">
          <div>
            <div className="text-xs font-semibold text-[#8A621C]">Data Source &amp; 30-Day Field Comparison</div>
            <h3 className="font-display text-lg font-semibold text-[#132A20]">
              Recent Rainfall &amp; Temperature by Source
            </h3>
          </div>

          {/* Source Selector: NASA POWER, Meteomatics Weather API, or Both Side by Side */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#EAE4D7] rounded-lg text-xs self-start md:self-auto">
            {(
              [
                { id: 'power', label: 'NASA POWER' },
                { id: 'weather', label: 'Meteomatics Weather API' },
                { id: 'both', label: 'Both Side by Side' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setDataSource(opt.id)}
                className={`px-2.5 py-1.5 rounded-md font-semibold transition-colors whitespace-nowrap ${
                  dataSource === opt.id ? 'bg-white text-[#0E4D3A] shadow-xs' : 'text-[#5A665E]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Edge Function Connection Status Notice (keeps rest of page working) */}
        {(dataSource === 'weather' || dataSource === 'both') && !edgeLoading && edgeWeather && !edgeWeather.connected && (
          <div className="p-3.5 rounded-lg bg-[#FDF8EE] border border-[#E8D5A7] text-xs text-[#6E4D12] flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#8A621C]" />
            <div>
              <div className="font-semibold">Weather service not connected yet</div>
              <p className="mt-0.5 text-[#47564E]">
                {edgeWeather.errorMessage ||
                  'The Meteomatics Supabase Edge Function or credentials are not connected yet. NASA POWER satellite observations and all other tools remain active below.'}
              </p>
            </div>
          </div>
        )}

        {/* >20% Disagreement Note */}
        {dataSource === 'both' && sourcesDisagreeOver20Pct && (
          <div className="p-3.5 rounded-lg bg-[#FDF6EE] border border-[#E3B47A] text-xs text-[#7D2B1B] flex items-start gap-2.5">
            <Scale className="w-4 h-4 shrink-0 mt-0.5 text-[#B93822]" />
            <div>
              <div className="font-semibold">
                The two weather sources disagree by more than 20%
                {rainDiffPct !== null && rainDiffPct > 20 ? ` (${rainDiffPct}% difference in 30-day rainfall)` : ''}
                {tempDiffPct !== null && tempDiffPct > 20 ? ` (${tempDiffPct}% difference in mean temperature)` : ''}
              </div>
              <p className="mt-0.5 text-[#47564E]">
                This may happen because NASA POWER averages across a coarser 0.5° × 0.625° (~55 km) satellite grid while Meteomatics downscales blended weather models (~1–10 km grid) to different cell centers over your terrain. Confirm heavy local showers with an on-farm rain gauge.
              </p>
            </div>
          </div>
        )}

        {/* Plain-Language Cards with Source & Resolution Labels */}
        <div
          className={`grid gap-4 ${
            dataSource === 'both' ? 'md:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {(dataSource === 'power' || dataSource === 'both') && (
            <div className="bg-[#FAF8F3] border border-[#E2DDD1] rounded-lg p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#0E4D3A]">
                  Source: NASA POWER Daily Point API
                </span>
                <span className="text-[11px] font-mono text-[#5E6D64]">
                  Res: 0.5° × 0.625° (~55 km grid)
                </span>
              </div>
              <div className="text-base font-semibold text-[#132A20]">
                Rain in the last 30 days:{' '}
                <span className="font-mono text-[#0E4D3A]">
                  {powerRain30 !== null ? `${powerRain30} mm` : 'Missing / Not reported'}
                </span>
              </div>
              <p className="text-xs text-[#47564E] leading-relaxed">
                {describeLast30RainPlain(powerRain30)}
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2DDD1] text-xs">
                <div>
                  <div className="text-[11px] text-[#5E6D64]">30-Day Mean Temp (NASA POWER)</div>
                  <div className="font-mono font-semibold text-[#132A20]">
                    {powerTemp30 !== null ? `${powerTemp30} °C` : 'Missing'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#5E6D64]">Last Available Date (POWER)</div>
                  <div className="font-mono font-semibold text-[#132A20]">
                    {analysis.lastAvailableDate ?? 'Unavailable'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {(dataSource === 'weather' || dataSource === 'both') && (
            <div className="bg-[#FAF8F3] border border-[#E2DDD1] rounded-lg p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#8A621C]">
                  Source: {edgeWeather?.sourceName || 'Meteomatics Weather API'} (Supabase Edge)
                </span>
                <span className="text-[11px] font-mono text-[#5E6D64]">
                  Res: {edgeWeather?.spatialResolution || '~1–10 km mix grid'}
                </span>
              </div>

              {edgeLoading ? (
                <div className="text-xs text-[#5E6D64] py-4">Loading Meteomatics comparison via Edge Function...</div>
              ) : edgeWeather?.connected ? (
                <>
                  <div className="text-base font-semibold text-[#132A20]">
                    Rain in the last 30 days:{' '}
                    <span className="font-mono text-[#8A621C]">
                      {wxRain30 !== null ? `${wxRain30} mm` : 'Missing / Not reported'}
                    </span>
                  </div>
                  <p className="text-xs text-[#47564E] leading-relaxed">
                    {describeLast30RainPlain(wxRain30)}
                  </p>
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E2DDD1] text-xs">
                    <div>
                      <div className="text-[11px] text-[#5E6D64]">30-Day Mean Temp (Meteomatics)</div>
                      <div className="font-mono font-semibold text-[#132A20]">
                        {wxTemp30 !== null ? `${wxTemp30} °C` : 'Missing'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-[#5E6D64]">Last Available Date (Meteomatics)</div>
                      <div className="font-mono font-semibold text-[#132A20]">
                        {edgeWeather.lastAvailableDate ?? 'Unavailable'}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-xs text-[#5E6D64] py-2">
                  Weather service not connected yet. Missing readings are never filled with estimates.
                </div>
              )}
            </div>
          )}
        </div>

        {/* 30-Day Side-by-Side Chart when Both Sources Selected & Connected */}
        {dataSource === 'both' && edgeWeather?.connected && sideBySide30.length > 0 && (
          <div className="pt-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <div className="text-xs font-semibold text-[#132A20]">
                30-Day Daily Rainfall Comparison: NASA POWER (~55 km) vs. Meteomatics (~1–10 km)
              </div>
              <span className="text-[11px] font-mono text-[#5E6D64]">mm / day · gaps = missing</span>
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sideBySide30}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                  <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={16} />
                  <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} />
                  <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                  <Bar dataKey="powerRain" name="NASA POWER (~55 km) mm" fill="#0E4D3A" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="weatherRain" name="Meteomatics (~1–10 km) mm" fill="#B8862D" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Real-Time Live Weather & 7-Day Farm Forecast */}
      {forecast && (
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#ECE8DD]">
            <div>
              <h3 className="font-display text-lg font-semibold text-[#132A20]">{t('env.weatherTitle')}</h3>
              <p className="text-xs text-[#5E6D64] mt-0.5">
                {forecast.source} (~9–11 km grid) · {forecast.current.timezone} · Updated{' '}
                <span className="font-mono">{forecast.fetchedAt.slice(0, 16).replace('T', ' ')} UTC</span>
              </p>
            </div>
            <div className="text-xs text-[#0E4D3A] font-semibold tabular-nums">
              {t('env.next7Days')}: {forecast.weeklyRainTotalMm} mm rain expected ·{' '}
              {forecast.minForecastTempC ?? '—'}°C – {forecast.maxForecastTempC ?? '—'}°C
            </div>
          </div>

          <div className="grid lg:grid-cols-12 gap-4 items-stretch">
            <div className="lg:col-span-4 bg-[#FAF8F3] border border-[#E2DDD1] rounded-lg p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#8A621C]">Current Conditions · Open-Meteo</div>
                  <div className="font-mono text-3xl font-semibold text-[#132A20] mt-1 tabular-nums">
                    {forecast.current.temperatureC !== null ? `${forecast.current.temperatureC}°C` : 'Missing'}
                  </div>
                  <div className="text-xs font-medium text-[#2E3E35] mt-0.5">{forecast.current.conditionLabel}</div>
                </div>
                <WeatherConditionIcon code={forecast.current.weatherCode} className="w-8 h-8" />
              </div>

              <p className="text-xs text-[#47564E] leading-relaxed">{forecast.current.conditionSummary}</p>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E2DDD1] text-[11px] text-[#47564E] tabular-nums">
                <div>
                  <div className="text-[#6E7C73]">{t('env.humidity')}</div>
                  <div className="font-mono font-semibold text-[#132A20]">{forecast.current.humidityPct ?? '—'}%</div>
                </div>
                <div>
                  <div className="text-[#6E7C73]">{t('env.wind')}</div>
                  <div className="font-mono font-semibold text-[#132A20]">{forecast.current.windKmh ?? '—'} km/h</div>
                </div>
                <div>
                  <div className="text-[#6E7C73]">{t('env.feelsLike')}</div>
                  <div className="font-mono font-semibold text-[#132A20]">{forecast.current.feelsLikeC ?? '—'}°C</div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 flex overflow-x-auto snap-x gap-2.5 pb-1 md:grid md:grid-cols-7 md:overflow-visible">
              {forecast.daily.map((d) => (
                <div
                  key={d.date}
                  className="min-w-[118px] md:min-w-0 snap-start bg-[#FAF8F3] border border-[#ECE8DD] rounded-lg p-3 flex flex-col justify-between text-xs shrink-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[#132A20]">{d.dayLabel}</span>
                    <WeatherConditionIcon code={d.weatherCode} className="w-4 h-4" />
                  </div>
                  <div className="text-[11px] text-[#5E6D64] truncate mt-1">{d.conditionLabel}</div>
                  <div className="mt-2 font-mono font-semibold text-[#132A20] tabular-nums">
                    {d.tempMaxC ?? '—'}° <span className="text-[#6E7C73] font-normal">/ {d.tempMinC ?? '—'}°</span>
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-[11px] text-[#47564E] tabular-nums">
                    <div className="flex items-center justify-between">
                      <span>Rain</span>
                      <span className="font-mono font-medium text-[#0E4D3A]">{d.precipSumMm ?? '—'} mm</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>{t('env.rainChance')}</span>
                      <span className="font-mono">{d.precipProbPct ?? '—'}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Potential Agricultural Hazards & Field Action Checklist */}
      {hazards.length > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-[#132A20] flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-[#B8862D]" />
              {t('env.hazardsTitle')}
            </h3>
            <p className="text-xs text-[#5E6D64] mt-0.5">
              Combines Open-Meteo 7-day forecast (~11 km) with NASA POWER soil wetness (0.5° grid) and SRTM slope (30–90 m).
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {hazards.map((hz) => {
              const st = severityStyles(hz.severity);
              return (
                <div key={hz.id} className={`border rounded-xl p-5 space-y-2.5 ${st.card}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-semibold text-[#5E6D64]">
                        {hz.type} · {hz.timingWindow}
                      </div>
                      <h4 className="text-base font-semibold text-[#132A20] mt-0.5">{hz.title}</h4>
                    </div>
                    <span className={`text-xs font-bold whitespace-nowrap ${st.badge}`}>{hz.severity} Risk</span>
                  </div>
                  <p className="text-xs text-[#2E3E35] leading-relaxed">{hz.plainSummary}</p>
                  <div className="text-[11px] font-mono text-[#5E6D64]">{hz.triggerDetail}</div>
                  <div className="pt-2 border-t border-black/10 space-y-1">
                    <div className="text-[11px] font-semibold text-[#132A20]">What You Can Do:</div>
                    <ul className="space-y-1 text-xs text-[#2E3E35] list-disc list-inside">
                      {hz.farmerActions.map((act) => (
                        <li key={act}>{act}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Layman Plain-Language NASA Summary Cards (Labeled with Source & Resolution) */}
      <div className="space-y-3">
        <div>
          <h3 className="font-display text-xl font-semibold text-[#132A20]">{t('env.plainSummaryTitle')}</h3>
          <p className="text-xs text-[#5E6D64] mt-0.5">
            Plain-language summary of the past 180 days of NASA POWER observations (through {analysis.lastAvailableDate ?? 'latest release'}).
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#5E6D64]">
              <span className="font-semibold text-[#132A20] flex items-center gap-1.5">
                <CloudRain className="w-4 h-4 text-[#0E4D3A]" /> {t('env.rainCard')}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[#5E6D64]">NASA POWER · ~55 km grid</div>
            <div className={`text-sm font-semibold ${rainPlain.tone}`}>{rainPlain.label}</div>
            <p className="text-xs text-[#3B4A42] leading-relaxed">{rainPlain.note}</p>
          </div>

          <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#5E6D64]">
              <span className="font-semibold text-[#132A20] flex items-center gap-1.5">
                <ThermometerSun className="w-4 h-4 text-[#B8862D]" /> {t('env.heatCard')}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[#5E6D64]">NASA POWER T2M · ~55 km grid</div>
            <div className={`text-sm font-semibold ${heatPlain.tone}`}>{heatPlain.label}</div>
            <p className="text-xs text-[#3B4A42] leading-relaxed">{heatPlain.note}</p>
          </div>

          <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#5E6D64]">
              <span className="font-semibold text-[#132A20] flex items-center gap-1.5">
                <Droplets className="w-4 h-4 text-[#0E4D3A]" /> {t('env.soilCard')}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[#5E6D64]">NASA POWER GWETROOT · 0–100 cm</div>
            <div className={`text-sm font-semibold ${soilPlain.tone}`}>{soilPlain.label}</div>
            {soilPlain.pct !== null && (
              <div className="w-full h-1.5 bg-[#EAE4D7] rounded-full overflow-hidden">
                <div className="h-full bg-[#0E4D3A]" style={{ width: `${Math.min(100, Math.max(4, soilPlain.pct))}%` }} />
              </div>
            )}
            <p className="text-xs text-[#3B4A42] leading-relaxed">{soilPlain.note}</p>
          </div>

          <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#5E6D64]">
              <span className="font-semibold text-[#132A20] flex items-center gap-1.5">
                <Wind className="w-4 h-4 text-[#5E6D64]" /> {t('env.slopeCard')}
              </span>
            </div>
            <div className="text-[10px] font-mono text-[#5E6D64]">SRTM / Copernicus DEM · 30–90 m</div>
            <div className={`text-sm font-semibold ${slopePlain.tone}`}>{slopePlain.label}</div>
            <p className="text-xs text-[#3B4A42] leading-relaxed">{slopePlain.note}</p>
          </div>
        </div>
      </div>

      {/* Charts Grid (NASA POWER 180-Day & 10-Year Climatology, connectNulls={false}) */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Rainfall & Observed ET0 */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <h3 className="text-sm font-semibold text-[#132A20]">
              {viewMode === 'simple'
                ? 'Daily Rain vs. Water Loss (NASA POWER ~55 km)'
                : 'NASA POWER Daily Rainfall (PRECTOTCORR) vs ET₀'}
            </h3>
            <span className="text-xs font-mono text-[#5E6D64] shrink-0">mm / day</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            {viewMode === 'simple'
              ? 'Green bars show satellite rain each day. Gold line shows sun & wind drying speed. Blank spots mean satellite records were missing (never estimated).'
              : 'Source: NASA POWER (0.5° × 0.625°). Missing observations remain null without gap-filling.'}
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={slicedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={22} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <Bar dataKey="precipMm" name="Daily Rain (mm)" fill="#0E4D3A" radius={[2, 2, 0, 0]} />
                <Line
                  type="monotone"
                  dataKey="et0Mm"
                  name="Water Loss ET0 (mm)"
                  stroke="#B8862D"
                  strokeWidth={1.8}
                  dot={false}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Temperature & Heat Stress */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <h3 className="text-sm font-semibold text-[#132A20]">
              {viewMode === 'simple'
                ? 'Daily Warmth & 35°C Heat Danger Line (NASA POWER)'
                : 'NASA POWER T2M & T2M_MAX (0.5° Grid)'}
            </h3>
            <span className="text-xs font-mono text-[#5E6D64] shrink-0">°C</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            {viewMode === 'simple'
              ? 'Afternoon highs above the red 35°C line signal crop heat stress that can reduce pollination.'
              : 'Source: NASA POWER T2M and T2M_MAX (°C) across 0.5° × 0.625° grid.'}
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={slicedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={22} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <ReferenceLine
                  y={35}
                  stroke="#B93822"
                  strokeDasharray="4 4"
                  label={{ value: '35°C Stress', fontSize: 10, fill: '#B93822', position: 'insideTopRight' }}
                />
                <Area
                  type="monotone"
                  dataKey="tempMaxC"
                  name="Afternoon High (°C)"
                  stroke="#B8862D"
                  fill="#B8862D"
                  fillOpacity={0.14}
                  strokeWidth={1.6}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="tempMeanC"
                  name="Daily Mean (°C)"
                  stroke="#132A20"
                  strokeWidth={1.6}
                  dot={false}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Soil Wetness Profile */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <h3 className="text-sm font-semibold text-[#132A20]">
              {viewMode === 'simple'
                ? 'Ground Moisture: Top Soil vs. Deep Roots (GWETROOT)'
                : 'NASA POWER Surface & Root-Zone Wetness (0–1)'}
            </h3>
            <span className="text-xs font-mono text-[#5E6D64] shrink-0">% Wetness</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            {viewMode === 'simple'
              ? 'Solid green shows moisture deeper down (0–100 cm) where crop roots drink. Dashed line shows top 5 cm seedbed moisture.'
              : 'Source: NASA POWER / SMAP GWETROOT & GWETTOP (0.5° assimilated grid).'}
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={slicedDaily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="shortDate" tick={{ fontSize: 10, fill: '#5E6D64' }} minTickGap={22} />
                <YAxis tick={{ fontSize: 10, fill: '#5E6D64' }} domain={[0, 100]} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <Area
                  type="monotone"
                  dataKey="smRootPct"
                  name="Deep Root Moisture (0–100 cm) %"
                  stroke="#0E4D3A"
                  fill="#0E4D3A"
                  fillOpacity={0.16}
                  strokeWidth={2}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="smTopPct"
                  name="Top Seedbed (0–5 cm) %"
                  stroke="#4F7F6D"
                  strokeWidth={1.4}
                  strokeDasharray="3 3"
                  dot={false}
                  connectNulls={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 10-Year Monthly Climatology */}
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-1 gap-2">
            <h3 className="text-sm font-semibold text-[#132A20]">
              {viewMode === 'simple'
                ? '10-Year Normal Monthly Rain & Temperature (Jan–Dec)'
                : '10-Year NASA POWER Monthly Climatology (PRECTOTCORR & T2M)'}
            </h3>
            <span className="text-xs font-mono text-[#5E6D64] shrink-0">mm/mo · °C</span>
          </div>
          <p className="text-xs text-[#5E6D64] mb-4">
            {viewMode === 'simple'
              ? 'Shows typical rainfall and temperature for each month over the past 10 years so you can plan your planting calendar.'
              : 'Source: NASA POWER 10-year monthly climatology at farm centroid (0.5° × 0.625° grid).'}
          </p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={climo10Yr}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ECE8DD" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#5E6D64' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#5E6D64' }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#B8862D' }} />
                <Tooltip contentStyle={{ backgroundColor: '#FAF8F3', borderColor: '#D8D2C3', fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="avgMonthlyRainMm" name="10-Yr Avg Monthly Rain (mm)" fill="#176B4F" radius={[3, 3, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="avgTempC"
                  name="10-Yr Avg Temp (°C)"
                  stroke="#B8862D"
                  strokeWidth={2}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Interpreted Insights */}
      <div>
        <h3 className="font-display text-xl font-semibold text-[#132A20] mb-1">
          {viewMode === 'simple'
            ? 'What These Satellite Checks Mean For Your Crops'
            : 'Interpreted Environmental Findings & Uncertainty Boundaries'}
        </h3>
        <p className="text-sm text-[#47564E] mb-4">
          {viewMode === 'simple'
            ? 'Plain-language takeaways paired with simple ground checks you can do yourself on the farm.'
            : 'Each finding separates direct satellite/gridded observations from agronomic interpretation and states what local checks remain necessary.'}
        </p>

        <div className="grid md:grid-cols-2 gap-5">
          {analysis.insights.map((ins) => (
            <div key={ins.id} className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[#5E6D64] font-medium">
                    {ins.category}
                    {viewMode === 'technical' ? ` · ${ins.observationType}` : ''}
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
                  <span className="font-semibold text-[#132A20]">
                    {viewMode === 'simple' ? 'What satellites saw: ' : `What was observed (${ins.whenObserved}): `}
                  </span>
                  {ins.whatWasObserved}
                </div>
                <div>
                  <span className="font-semibold text-[#132A20]">
                    {viewMode === 'simple' ? 'How it affects your farm: ' : 'What it could mean: '}
                  </span>
                  {ins.whatItCouldMean}
                </div>
                {viewMode === 'technical' && (
                  <div className="pt-1 border-t border-[#F0ECE2] text-[#5E6D64]">
                    <span className="font-semibold text-[#2E3E35]">What it cannot establish: </span>
                    {ins.whatItCannotEstablish}
                  </div>
                )}
                <div className="text-[#0E4D3A]">
                  <span className="font-semibold">{viewMode === 'simple' ? 'Quick field check: ' : 'Additional local info needed: '}</span>
                  {ins.additionalInfoNeeded}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* NASA Dataset Provenance & Harmonisation Table */}
      {viewMode === 'technical' && (
        <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E2DDD1] bg-[#FAF8F3]">
            <h3 className="font-display text-lg font-semibold text-[#132A20]">
              NASA Earth Observation Provenance &amp; Harmonisation Ledger
            </h3>
            <p className="text-xs text-[#5E6D64] mt-0.5">
              Transparent audit of every satellite and gridded dataset integrated for your farm, including spatial resolution, missing records, and scientific limitations.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E2DDD1] bg-[#F2EFE7]/70 text-[#2E3E35]">
                  <th className="py-3 px-4 font-semibold">Mission / Dataset</th>
                  <th className="py-3 px-4 font-semibold">Observation Date / Window</th>
                  <th className="py-3 px-4 font-semibold">Spatial &amp; Temporal Res.</th>
                  <th className="py-3 px-4 font-semibold">Quality &amp; Missing</th>
                  <th className="py-3 px-4 font-semibold">Processing &amp; Limitations</th>
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
      )}
    </div>
  );
}
