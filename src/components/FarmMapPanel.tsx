import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Calendar, Layers, Mountain, Satellite } from 'lucide-react';
import { api } from '../lib/api';
import type { EnvironmentalAnalysis, Farm, GibsLayerCapability } from '../types';

interface Props {
  farm: Farm;
  analysis: EnvironmentalAnalysis;
  compact?: boolean;
}

type BaseMapType = 'imagery' | 'streets';

function offsetIsoDate(maxDate: string, daysBack: number): string {
  const base = new Date(`${maxDate}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    return new Date(Date.now() - daysBack * 86400 * 1000).toISOString().slice(0, 10);
  }
  const shifted = new Date(base.getTime() - daysBack * 86400 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function clampSliderDays(layer: GibsLayerCapability | null, desiredDaysBack: number): number {
  if (!layer) return desiredDaysBack;
  const minT = new Date(`${layer.minDate}T00:00:00Z`).getTime();
  const maxT = new Date(`${layer.maxDate}T00:00:00Z`).getTime();
  const spanDays = Math.max(1, Math.min(365, Math.floor((maxT - minT) / 86400000)));
  return Math.max(0, Math.min(spanDays, desiredDaysBack));
}

export function FarmMapPanel({ farm, analysis, compact = false }: Props) {
  const [baseMap, setBaseMap] = useState<BaseMapType>('imagery');
  const [capabilities, setCapabilities] = useState<GibsLayerCapability[]>([]);
  const [capabilitiesSource, setCapabilitiesSource] = useState<string>(
    'NASA GIBS WMTSCapabilities.xml (epsg3857/best)'
  );
  const [activeLayerId, setActiveLayerId] = useState<string>('none');
  const [opacity, setOpacity] = useState(0.7);
  const [daysBackFromLatest, setDaysBackFromLatest] = useState(0);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const gibsLayerRef = useRef<L.TileLayer | null>(null);
  const boundaryGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getGibsCapabilities()
      .then((res) => {
        if (!active) return;
        setCapabilities(res.layers || []);
        if (res.source) setCapabilitiesSource(res.source);
      })
      .catch(() => {
        // Non-fatal; Boundary Only remains active
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedCapability = capabilities.find((c) => c.id === activeLayerId) ?? null;

  const maxSliderDays = (() => {
    if (!selectedCapability) return 180;
    const minT = new Date(`${selectedCapability.minDate}T00:00:00Z`).getTime();
    const maxT = new Date(`${selectedCapability.maxDate}T00:00:00Z`).getTime();
    if (Number.isNaN(minT) || Number.isNaN(maxT)) return 180;
    return Math.max(1, Math.min(365, Math.floor((maxT - minT) / 86400000)));
  })();

  const effectiveDaysBack = clampSliderDays(selectedCapability, daysBackFromLatest);
  const gibsDate = selectedCapability
    ? offsetIsoDate(selectedCapability.maxDate, effectiveDaysBack)
    : new Date(Date.now() - 5 * 86400 * 1000).toISOString().slice(0, 10);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = L.map(mapRef.current, {
      center: [farm.centroidLat, farm.centroidLon],
      zoom: compact ? 15 : 14,
      zoomControl: true,
    });
    leafletRef.current = map;
    boundaryGroupRef.current = L.layerGroup().addTo(map);
    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      map.remove();
      leafletRef.current = null;
      baseLayerRef.current = null;
      gibsLayerRef.current = null;
      boundaryGroupRef.current = null;
    };
  }, [farm.id, compact]);

  // Update base map & farm boundary whenever farm or baseMap changes
  useEffect(() => {
    const map = leafletRef.current;
    const bGroup = boundaryGroupRef.current;
    if (!map || !bGroup) return;

    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    const url =
      baseMap === 'imagery'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    baseLayerRef.current = L.tileLayer(url, {
      attribution: baseMap === 'imagery' ? 'Esri World Imagery' : 'OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    bGroup.clearLayers();
    if (farm.polygonCoords.length >= 3) {
      const poly = L.polygon(
        farm.polygonCoords.map((p) => [p.lat, p.lon] as [number, number]),
        {
          color: '#D4A13E',
          weight: 3,
          fillColor: '#0E4D3A',
          fillOpacity: 0.22,
        }
      ).addTo(bGroup);
      poly.bindPopup(
        `<div style="font-size:12px;line-height:1.45;">
          <strong>${farm.name}</strong><br/>
          Area: ${farm.sizeHectares} ha · Elevation: ${analysis.elevationMeters ?? 'N/A'} m<br/>
          Slope: ${analysis.terrainSlopePct ?? 'N/A'}% · Soil: ${farm.soilTexture}
        </div>`
      );
      if (activeLayerId === 'none') {
        map.fitBounds(poly.getBounds(), { padding: [36, 36], maxZoom: 16 });
      }
    } else {
      L.circleMarker([farm.centroidLat, farm.centroidLon], {
        radius: 8,
        color: '#D4A13E',
        fillColor: '#0E4D3A',
        fillOpacity: 0.85,
      }).addTo(bGroup);
      map.setView([farm.centroidLat, farm.centroidLon], 14);
    }
  }, [farm, baseMap, analysis.elevationMeters, analysis.terrainSlopePct]);

  // Update NASA GIBS WMTS overlay strictly from WMTSCapabilities metadata
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    if (gibsLayerRef.current) {
      map.removeLayer(gibsLayerRef.current);
      gibsLayerRef.current = null;
    }

    if (selectedCapability) {
      const maxNativeZoom = selectedCapability.tileMatrixSet.includes('Level6')
        ? 6
        : selectedCapability.tileMatrixSet.includes('Level7')
        ? 7
        : 9;
      const gibsUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${selectedCapability.id}/default/${gibsDate}/${selectedCapability.tileMatrixSet}/{z}/{y}/{x}.${selectedCapability.format}`;

      gibsLayerRef.current = L.tileLayer(gibsUrl, {
        opacity,
        maxNativeZoom,
        maxZoom: 18,
        attribution:
          'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (ESDIS)',
      }).addTo(map);

      if (map.getZoom() > 11) {
        map.setZoom(10);
      }
    }
  }, [selectedCapability, opacity, gibsDate]);

  return (
    <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-[#E2DDD1] flex flex-wrap items-center justify-between gap-3 bg-[#FAF8F3]">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-[#0E4D3A]" />
          <span className="text-sm font-semibold text-[#132A20]">Geospatial Farm &amp; NASA GIBS Satellite Layers</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-0.5 bg-[#EAE4D7] rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setBaseMap('imagery')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                baseMap === 'imagery' ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
              }`}
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setBaseMap('streets')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                baseMap === 'streets' ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
              }`}
            >
              Topo Map
            </button>
          </div>
        </div>
      </div>

      {/* Verified Capabilities Layer Picker */}
      {!compact && (
        <div className="px-4 py-2.5 border-b border-[#ECE8DD] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <label htmlFor="gibs-layer-picker" className="text-xs font-semibold text-[#2E3E35] whitespace-nowrap">
              NASA GIBS Layer:
            </label>
            <select
              id="gibs-layer-picker"
              value={activeLayerId}
              onChange={(e) => {
                setActiveLayerId(e.target.value);
                setDaysBackFromLatest(0);
              }}
              className="w-full sm:w-auto flex-1 max-w-md px-3 py-1.5 text-xs bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg font-medium text-[#132A20]"
            >
              <option value="none">Farm Boundary Only (Base Imagery)</option>
              {capabilities.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.title} ({layer.resolution})
                </option>
              ))}
            </select>
          </div>

          {selectedCapability && (
            <div className="text-[11px] font-mono text-[#5E6D64] whitespace-nowrap">
              Valid dates: {selectedCapability.minDate} to {selectedCapability.maxDate}
            </div>
          )}
        </div>
      )}

      {/* Map Viewport */}
      <div className={`relative w-full ${compact ? 'h-56 sm:h-64' : 'h-[300px] sm:h-[430px]'}`}>
        <div ref={mapRef} className="w-full h-full" />

        {/* Terrain & Coordinate Readout */}
        <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-xs border border-[#DFD9CB] rounded-lg px-2.5 sm:px-3 py-1.5 sm:py-2 text-xs shadow-sm max-w-[calc(100%-1.5rem)] sm:max-w-xs">
          <div className="flex items-center gap-2 font-mono text-[#132A20]">
            <Mountain className="w-3.5 h-3.5 text-[#0E4D3A]" />
            <span>
              {analysis.elevationMeters !== null ? `${analysis.elevationMeters} m elev` : 'Elev N/A'} ·{' '}
              {analysis.terrainSlopePct !== null ? `${analysis.terrainSlopePct}% slope` : 'Slope N/A'}
            </span>
          </div>
          <div className="font-mono text-[11px] text-[#5E6D64] mt-0.5">
            {farm.centroidLat.toFixed(4)}°, {farm.centroidLon.toFixed(4)}° · {farm.sizeHectares} ha
          </div>
        </div>
      </div>

      {/* Date Slider, Layer Controls & GIBS Attribution */}
      {!compact && (
        <div className="px-4 py-3.5 bg-[#FAF8F3] border-t border-[#E2DDD1] space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-[#132A20]">
                <Layers className="w-3.5 h-3.5 text-[#0E4D3A]" />
                <span>
                  {selectedCapability
                    ? `${selectedCapability.mission} (${selectedCapability.resolution})`
                    : 'Base Field Boundary'}
                </span>
                {selectedCapability && (
                  <span className="font-mono text-[#0E4D3A] bg-white border border-[#C6D8CE] px-2 py-0.5 rounded">
                    Date: {gibsDate}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#47564E]">
                {selectedCapability
                  ? selectedCapability.legendText
                  : 'Displays your registered field outline over base satellite imagery or street topography.'}
              </p>
              {selectedCapability && selectedCapability.colorRamp.length > 0 && (
                <div className="flex flex-wrap items-center gap-4 pt-1">
                  {selectedCapability.colorRamp.map((c) => (
                    <span key={c.label} className="inline-flex items-center gap-1.5 text-[11px] text-[#44544B]">
                      <span
                        className="w-3 h-3 rounded-xs border border-black/15"
                        style={{ backgroundColor: c.color }}
                      />
                      {c.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {selectedCapability && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5 text-xs shrink-0">
                <label className="flex flex-col gap-1 min-w-[200px]">
                  <span className="text-[#2E3E35] font-medium flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-[#0E4D3A]" /> Date Slider
                    </span>
                    <span className="font-mono text-[11px] text-[#0E4D3A]">{gibsDate}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={maxSliderDays}
                    step={1}
                    value={maxSliderDays - effectiveDaysBack}
                    onChange={(e) => setDaysBackFromLatest(maxSliderDays - Number(e.target.value))}
                    className="w-full accent-[#0E4D3A]"
                  />
                  <span className="flex justify-between text-[10px] font-mono text-[#5E6D64]">
                    <span>{offsetIsoDate(selectedCapability.maxDate, maxSliderDays)}</span>
                    <span>{selectedCapability.maxDate}</span>
                  </span>
                </label>

                <label className="flex items-center gap-2">
                  <span className="text-[#47564E] font-medium">Opacity:</span>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                    className="w-20 accent-[#0E4D3A]"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-[#E2DDD1] text-[11px] text-[#5E6D64] flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span>
              Imagery provided by NASA Global Imagery Browse Services (GIBS), NASA/GSFC/ESDIS.
            </span>
            <span className="font-mono truncate max-w-md">
              Capabilities: {capabilitiesSource.includes('WMTSCapabilities') ? 'WMTSCapabilities.xml (epsg3857/best)' : capabilitiesSource}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
