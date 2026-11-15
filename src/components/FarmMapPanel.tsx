import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Layers, Mountain, Satellite } from 'lucide-react';
import type { EnvironmentalAnalysis, Farm } from '../types';

interface Props {
  farm: Farm;
  analysis: EnvironmentalAnalysis;
  compact?: boolean;
}

type BaseMapType = 'imagery' | 'streets';
type NasaOverlayId = 'none' | 'ndvi' | 'lst' | 'precip' | 'smap' | 'truecolor';

interface NasaLayerMeta {
  id: NasaOverlayId;
  label: string;
  mission: string;
  gibsLayer: string;
  resolution: string;
  legendText: string;
  colorRamp: Array<{ color: string; label: string }>;
}

const NASA_LAYERS: NasaLayerMeta[] = [
  {
    id: 'none',
    label: 'Boundary Only',
    mission: 'Local Polygon',
    gibsLayer: '',
    resolution: 'Field polygon',
    legendText: 'Displays your drawn plot outline over base satellite imagery or street topography.',
    colorRamp: [],
  },
  {
    id: 'ndvi',
    label: 'Vegetation (MODIS NDVI)',
    mission: 'NASA MODIS Terra 8-Day',
    gibsLayer: 'MODIS_Terra_NDVI_8Day',
    resolution: '250 m / pixel',
    legendText: 'Higher green intensity indicates denser photosynthetic canopy across 250 m pixels (may blend neighboring plots).',
    colorRamp: [
      { color: '#C8B08A', label: 'Sparse / Bare' },
      { color: '#7BB661', label: 'Moderate Canopy' },
      { color: '#1B5E20', label: 'Dense Greenness' },
    ],
  },
  {
    id: 'lst',
    label: 'Surface Temp (MODIS LST)',
    mission: 'NASA MODIS Thermal Day',
    gibsLayer: 'MODIS_Terra_Land_Surface_Temp_Day',
    resolution: '1 km / pixel',
    legendText: 'Daytime land-surface skin temperature context; cloud cover creates transparent gaps.',
    colorRamp: [
      { color: '#2B83BA', label: 'Cooler (<25°C)' },
      { color: '#FDAE61', label: 'Warm (32–38°C)' },
      { color: '#D7191C', label: 'Hot (>40°C)' },
    ],
  },
  {
    id: 'precip',
    label: 'Rainfall (GPM IMERG)',
    mission: 'NASA GPM Precipitation',
    gibsLayer: 'IMERG_Precipitation_Rate',
    resolution: '0.1° (~11 km)',
    legendText: 'Satellite precipitation rate snapshot. Because cells span ~11 km, verify convective showers locally.',
    colorRamp: [
      { color: '#9ECAE1', label: 'Light Rain' },
      { color: '#3182BD', label: 'Moderate' },
      { color: '#08306B', label: 'Heavy Storm' },
    ],
  },
  {
    id: 'smap',
    label: 'Soil Moisture (SMAP L4)',
    mission: 'NASA SMAP Assimilated',
    gibsLayer: 'SMAP_L4_Analyzed_Surface_Soil_Moisture',
    resolution: '9 km / pixel',
    legendText: 'Regional 0–5 cm surface soil moisture assimilation (9 km footprint); contextual rather than plot-exact.',
    colorRamp: [
      { color: '#D9A05B', label: 'Dry Surface' },
      { color: '#74C476', label: 'Moist' },
      { color: '#08519C', label: 'Wet / Saturated' },
    ],
  },
  {
    id: 'truecolor',
    label: 'Orbital True Color',
    mission: 'NASA MODIS Terra',
    gibsLayer: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    resolution: '250 m / pixel',
    legendText: 'Near-real-time orbital reflectance showing regional cloud cover, haze, and landscape greening.',
    colorRamp: [],
  },
];

function getRecentObsDate(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

export function FarmMapPanel({ farm, analysis, compact = false }: Props) {
  const [baseMap, setBaseMap] = useState<BaseMapType>('imagery');
  const [activeLayer, setActiveLayer] = useState<NasaOverlayId>('none');
  const [opacity, setOpacity] = useState(0.68);
  const [daysAgo, setDaysAgo] = useState(12);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const gibsLayerRef = useRef<L.TileLayer | null>(null);
  const boundaryGroupRef = useRef<L.LayerGroup | null>(null);

  const gibsDate = getRecentObsDate(daysAgo);
  const selectedMeta = NASA_LAYERS.find((l) => l.id === activeLayer) ?? NASA_LAYERS[0];

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

  // Update base map & boundary whenever farm or baseMap changes
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
      if (activeLayer === 'none') {
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

  // Update NASA GIBS WMTS overlay
  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    if (gibsLayerRef.current) {
      map.removeLayer(gibsLayerRef.current);
      gibsLayerRef.current = null;
    }

    if (activeLayer !== 'none' && selectedMeta.gibsLayer) {
      const matrixSet = activeLayer === 'truecolor' ? 'GoogleMapsCompatible_Level9' : 'GoogleMapsCompatible_Level9';
      const ext = activeLayer === 'truecolor' ? 'jpg' : 'png';
      const gibsUrl = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${selectedMeta.gibsLayer}/default/${gibsDate}/${matrixSet}/{z}/{y}/{x}.${ext}`;
      gibsLayerRef.current = L.tileLayer(gibsUrl, {
        opacity,
        maxNativeZoom: 9,
        maxZoom: 18,
        attribution: `NASA GIBS (${selectedMeta.mission})`,
      }).addTo(map);

      // Zoom out slightly when viewing coarse orbital layers so regional grid context is visible
      if (map.getZoom() > 11) {
        map.setZoom(10);
      }
    }
  }, [activeLayer, opacity, gibsDate, selectedMeta]);

  return (
    <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-[#E2DDD1] flex flex-wrap items-center justify-between gap-3 bg-[#FAF8F3]">
        <div className="flex items-center gap-2">
          <Satellite className="w-4 h-4 text-[#0E4D3A]" />
          <span className="text-sm font-semibold text-[#132A20]">Geospatial Farm & Satellite Layers</span>
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

      {/* Satellite Overlay Selector */}
      {!compact && (
        <div className="px-4 py-2.5 border-b border-[#ECE8DD] bg-white flex overflow-x-auto sm:flex-wrap items-center gap-1.5">
          {NASA_LAYERS.map((layer) => (
            <button
              key={layer.id}
              type="button"
              onClick={() => setActiveLayer(layer.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeLayer === layer.id
                  ? 'bg-[#0E4D3A] text-[#FAF8F3]'
                  : 'bg-[#F2EFE7] text-[#3B4A42] hover:bg-[#E5E0D3]'
              }`}
            >
              {layer.label}
            </button>
          ))}
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

      {/* Layer Controls, Timeline & Scientific Legend */}
      {!compact && (
        <div className="px-4 py-3.5 bg-[#FAF8F3] border-t border-[#E2DDD1] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1 max-w-2xl">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#132A20]">
              <Layers className="w-3.5 h-3.5 text-[#0E4D3A]" />
              <span>
                {selectedMeta.mission} ({selectedMeta.resolution})
              </span>
              {activeLayer !== 'none' && <span className="font-mono text-[#5E6D64]">· Composite {gibsDate}</span>}
            </div>
            <p className="text-xs text-[#47564E]">{selectedMeta.legendText}</p>
            {selectedMeta.colorRamp.length > 0 && (
              <div className="flex flex-wrap items-center gap-4 pt-1">
                {selectedMeta.colorRamp.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 text-[11px] text-[#44544B]">
                    <span className="w-3 h-3 rounded-xs border border-black/15" style={{ backgroundColor: c.color }} />
                    {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {activeLayer !== 'none' && (
            <div className="flex flex-wrap items-center gap-4 text-xs shrink-0">
              <label className="flex items-center gap-2">
                <span className="text-[#47564E] font-medium">Timeline:</span>
                <select
                  value={daysAgo}
                  onChange={(e) => setDaysAgo(Number(e.target.value))}
                  className="px-2 py-1 bg-white border border-[#D8D2C3] rounded text-xs font-mono"
                >
                  <option value={8}>8 days ago</option>
                  <option value={16}>16 days ago</option>
                  <option value={32}>1 month ago</option>
                  <option value={90}>3 months ago</option>
                  <option value={180}>6 months ago</option>
                </select>
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
      )}
    </div>
  );
}
