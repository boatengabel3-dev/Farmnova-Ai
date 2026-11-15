import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ArrowLeft, ArrowRight, Check, MapPin, Search, Trash2, Undo2, X } from 'lucide-react';
import type { Crop, Farm, GeoPoint } from '../types';

interface Props {
  initialFarm?: Farm | null;
  crops: Crop[];
  onSave: (payload: Partial<Farm>, existingId?: string) => Promise<void>;
  onClose?: () => void;
  isFirstOnboarding?: boolean;
}

const PRIORITY_OPTIONS = [
  'Improving soil health',
  'Conserving water',
  'Reducing erosion',
  'Increasing organic matter',
  'Improving nutrient cycling',
  'Reducing pest pressure',
  'Improving forage availability',
  'Adapting to changing rainfall',
  'Reducing heat-related crop vulnerability',
  'Market suitability',
];

function computeGeodesicAreaHectares(points: GeoPoint[]): number {
  if (points.length < 3) return 0;
  const R = 6378137;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const lon1 = (p1.lon * Math.PI) / 180;
    const lon2 = (p2.lon * Math.PI) / 180;
    const lat1 = (p1.lat * Math.PI) / 180;
    const lat2 = (p2.lat * Math.PI) / 180;
    area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  const sqMeters = Math.abs((area * R * R) / 2);
  return Number((sqMeters / 10000).toFixed(2));
}

function computeCentroid(points: GeoPoint[]): GeoPoint {
  if (points.length === 0) return { lat: 7.3833, lon: -1.3667 };
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lon: acc.lon + p.lon }), { lat: 0, lon: 0 });
  return {
    lat: Number((sum.lat / points.length).toFixed(5)),
    lon: Number((sum.lon / points.length).toFixed(5)),
  };
}

export function FarmOnboardingModal({ initialFarm, crops, onSave, onClose, isFirstOnboarding }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Farm Info
  const [name, setName] = useState(initialFarm?.name ?? '');
  const [country, setCountry] = useState(initialFarm?.country ?? '');
  const [region, setRegion] = useState(initialFarm?.region ?? '');
  const [district, setDistrict] = useState(initialFarm?.district ?? '');
  const [sizeHectares, setSizeHectares] = useState<string>(initialFarm ? String(initialFarm.sizeHectares) : '3.5');
  const [farmingType, setFarmingType] = useState(initialFarm?.farmingType ?? 'Rainfed mixed cereal-legume smallholder');

  // Step 2: Geographic Location & Polygon
  const [polygonCoords, setPolygonCoords] = useState<GeoPoint[]>(
    initialFarm?.polygonCoords?.length
      ? initialFarm.polygonCoords
      : [
          { lat: 7.3845, lon: -1.3680 },
          { lat: 7.3845, lon: -1.3654 },
          { lat: 7.3821, lon: -1.3654 },
          { lat: 7.3821, lon: -1.3680 },
        ]
  );
  const [centroidLat, setCentroidLat] = useState<number>(initialFarm?.centroidLat ?? 7.3833);
  const [centroidLon, setCentroidLon] = useState<number>(initialFarm?.centroidLon ?? -1.3667);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // Step 3: Soil Information
  const [soilType, setSoilType] = useState(initialFarm?.soilType ?? 'Unknown');
  const [soilTexture, setSoilTexture] = useState(initialFarm?.soilTexture ?? 'Sandy Loam');
  const [drainage, setDrainage] = useState(initialFarm?.drainage ?? 'Well-drained');
  const [soilFertility, setSoilFertility] = useState(initialFarm?.soilFertility ?? 'Unknown');
  const [omUnknown, setOmUnknown] = useState(initialFarm ? initialFarm.organicMatterPct === null : true);
  const [organicMatterPct, setOrganicMatterPct] = useState(
    initialFarm?.organicMatterPct !== null && initialFarm?.organicMatterPct !== undefined ? String(initialFarm.organicMatterPct) : ''
  );
  const [phUnknown, setPhUnknown] = useState(initialFarm ? initialFarm.soilPh === null : true);
  const [soilPh, setSoilPh] = useState(
    initialFarm?.soilPh !== null && initialFarm?.soilPh !== undefined ? String(initialFarm.soilPh) : ''
  );
  const [irrigationAvailable, setIrrigationAvailable] = useState(initialFarm?.irrigationAvailable ?? 'None (strictly rainfed)');
  const [soilNotes, setSoilNotes] = useState(initialFarm?.soilNotes ?? '');

  // Step 4: Crop History
  const [previousCrops, setPreviousCrops] = useState<string[]>(initialFarm?.previousCrops ?? ['Maize']);
  const [currentCrops, setCurrentCrops] = useState<string[]>(initialFarm?.currentCrops ?? ['Maize']);
  const [plannedCrops, setPlannedCrops] = useState<string[]>(initialFarm?.plannedCrops ?? ['Cowpea']);
  const [plantingSeasons, setPlantingSeasons] = useState(initialFarm?.plantingSeasons ?? 'Major rains (April–July) & Minor rains (September–November)');
  const [harvestPeriods, setHarvestPeriods] = useState(initialFarm?.harvestPeriods ?? 'August and December');
  const [pestHistory, setPestHistory] = useState(initialFarm?.pestHistory ?? '');
  const [availableWater, setAvailableWater] = useState(initialFarm?.availableWater ?? 'Rainfed seasonal');
  const [equipmentNotes, setEquipmentNotes] = useState(initialFarm?.equipmentNotes ?? '');
  const [marketPreferences, setMarketPreferences] = useState(initialFarm?.marketPreferences ?? '');

  // Step 5: Priorities
  const [priorities, setPriorities] = useState<string[]>(
    initialFarm?.priorities?.length ? initialFarm.priorities : ['Improving soil health', 'Conserving water', 'Adapting to changing rainfall']
  );

  // Leaflet map refs for Step 2
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (step !== 2 || !mapContainerRef.current) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      center: [centroidLat, centroidLon],
      zoom: 15,
    });

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Esri World Imagery',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;
    layerGroupRef.current = group;

    map.on('click', (e: L.LeafletMouseEvent) => {
      const pt = { lat: Number(e.latlng.lat.toFixed(5)), lon: Number(e.latlng.lng.toFixed(5)) };
      setPolygonCoords((prev) => {
        const next = [...prev, pt];
        const c = computeCentroid(next);
        setCentroidLat(c.lat);
        setCentroidLon(c.lon);
        const area = computeGeodesicAreaHectares(next);
        if (area > 0) setSizeHectares(String(area));
        return next;
      });
    });

    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      layerGroupRef.current = null;
    };
  }, [step]);

  // Redraw polygon & draggable vertex markers whenever polygonCoords updates
  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group || step !== 2) return;
    group.clearLayers();

    if (polygonCoords.length >= 3) {
      L.polygon(
        polygonCoords.map((p) => [p.lat, p.lon] as [number, number]),
        { color: '#D4A13E', weight: 2.5, fillColor: '#0E4D3A', fillOpacity: 0.28 }
      ).addTo(group);
    } else if (polygonCoords.length === 2) {
      L.polyline(
        polygonCoords.map((p) => [p.lat, p.lon] as [number, number]),
        { color: '#D4A13E', weight: 2.5 }
      ).addTo(group);
    }

    polygonCoords.forEach((pt, idx) => {
      const marker = L.marker([pt.lat, pt.lon], {
        draggable: true,
        icon: L.divIcon({
          className: '',
          html: `<div style="width:14px;height:14px;border-radius:9999px;background:#FAF8F3;border:2.5px solid #0E4D3A;box-shadow:0 1px 4px rgba(0,0,0,0.4);cursor:grab;"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(group);

      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        setPolygonCoords((prev) => {
          const next = prev.map((p, i) => (i === idx ? { lat: Number(ll.lat.toFixed(5)), lon: Number(ll.lng.toFixed(5)) } : p));
          const c = computeCentroid(next);
          setCentroidLat(c.lat);
          setCentroidLon(c.lon);
          const area = computeGeodesicAreaHectares(next);
          if (area > 0) setSizeHectares(String(area));
          return next;
        });
      });
    });
  }, [polygonCoords, step]);

  async function handleLocationSearch() {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchMessage(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`
      );
      const list = (await res.json()) as any[];
      if (list.length === 0) {
        setSearchMessage('No location match found. Try adding region or country.');
        return;
      }
      const hit = list[0];
      const lat = Number(Number(hit.lat).toFixed(5));
      const lon = Number(Number(hit.lon).toFixed(5));
      setCentroidLat(lat);
      setCentroidLon(lon);
      // Create an initial editable ~200m square around searched location
      const d = 0.0011;
      const box = [
        { lat: Number((lat + d).toFixed(5)), lon: Number((lon - d).toFixed(5)) },
        { lat: Number((lat + d).toFixed(5)), lon: Number((lon + d).toFixed(5)) },
        { lat: Number((lat - d).toFixed(5)), lon: Number((lon + d).toFixed(5)) },
        { lat: Number((lat - d).toFixed(5)), lon: Number((lon - d).toFixed(5)) },
      ];
      setPolygonCoords(box);
      setSizeHectares(String(computeGeodesicAreaHectares(box)));
      mapInstanceRef.current?.setView([lat, lon], 15);
      setSearchMessage(`Centered on ${hit.display_name.split(',').slice(0, 2).join(', ')}. Drag vertices or click map to refine your boundary.`);
    } catch {
      setSearchMessage('Location search unreachable; click directly on the map or enter coordinates.');
    } finally {
      setSearching(false);
    }
  }

  function toggleListValue(list: string[], setList: (v: string[]) => void, val: string) {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  }

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          country: country.trim(),
          region: region.trim(),
          district: district.trim(),
          sizeHectares: Number(sizeHectares) || 1.0,
          farmingType,
          centroidLat,
          centroidLon,
          polygonCoords,
          soilType,
          soilTexture,
          drainage,
          soilFertility,
          organicMatterPct: omUnknown || organicMatterPct === '' ? null : Number(organicMatterPct),
          soilPh: phUnknown || soilPh === '' ? null : Number(soilPh),
          irrigationAvailable,
          soilNotes,
          previousCrops,
          currentCrops,
          plannedCrops,
          plantingSeasons,
          harvestPeriods,
          pestHistory,
          availableWater,
          equipmentNotes,
          marketPreferences,
          priorities,
        },
        initialFarm?.id
      );
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  const cropNames = crops.length > 0 ? crops.map((c) => c.name) : ['Maize', 'Cowpea', 'Groundnut', 'Soybean', 'Sorghum', 'Pearl Millet', 'Cassava', 'Yam', 'Rice (Upland / Bunded)', 'Mucuna (Velvet Bean)', 'Sunn Hemp', 'Pigeon Pea'];
  const computedArea = computeGeodesicAreaHectares(polygonCoords);

  const stepLabels = ['Farm Info', 'Location & Boundary', 'Soil Profile', 'Crop History', 'Priorities', 'Review'];

  return (
    <div className="fixed inset-0 z-50 bg-[#132A20]/55 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#FAF8F3] border border-[#DFD9CB] rounded-xl w-full max-w-4xl max-h-[95dvh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-white border-b border-[#E2DDD1] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-semibold text-[#132A20] truncate">
              {initialFarm ? `Edit Farm: ${initialFarm.name}` : isFirstOnboarding ? 'Register Your First Farm' : 'Register New Farm'}
            </h2>
            <p className="text-xs text-[#5E6D64] mt-0.5">
              Step {step} of 6 · {stepLabels[step - 1]}
            </p>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Exit farm registration"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-[#D8D2C3] text-xs font-semibold text-[#5E6D64] hover:text-[#132A20] hover:bg-[#F2EFE7] transition-colors shrink-0"
            >
              <span>Exit</span>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Step Progress Bar */}
        <div className="px-4 sm:px-6 py-2.5 sm:py-3 bg-[#F2EFE7] border-b border-[#E2DDD1] grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-1.5 sm:gap-2">
          {stepLabels.map((lbl, idx) => {
            const num = idx + 1;
            const active = step === num;
            const done = step > num;
            return (
              <button
                key={lbl}
                type="button"
                onClick={() => setStep(num)}
                className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors truncate ${
                  active
                    ? 'bg-[#0E4D3A] text-[#FAF8F3]'
                    : done
                    ? 'bg-white text-[#0E4D3A] border border-[#C6D8CE]'
                    : 'text-[#5A665E] hover:bg-white/60'
                }`}
              >
                {num}. {lbl}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && <div className="p-3 rounded-lg bg-[#FDF2F0] border border-[#E5B8B0] text-xs text-[#8C2D19]">{error}</div>}

          {step === 1 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Farm Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., North Ridge Maize Plot"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Country *</label>
                <input
                  type="text"
                  required
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  placeholder="e.g., Brazil, India, USA, Kenya, Ghana"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Region / State / Province *</label>
                <input
                  type="text"
                  required
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g., Iowa, Punjab, Minas Gerais, Ashanti"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">District / County / Ward</label>
                <input
                  type="text"
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="Optional local district"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Estimated Farm Size (Hectares)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={sizeHectares}
                  onChange={(e) => setSizeHectares(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Farming System Type</label>
                <select
                  value={farmingType}
                  onChange={(e) => setFarmingType(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                >
                  <option>Rainfed mixed cereal-legume smallholder</option>
                  <option>Crop-livestock integrated farm</option>
                  <option>Root & tuber transitional plot</option>
                  <option>Irrigated commercial vegetable & grain</option>
                  <option>Agroforestry / conservation agriculture</option>
                </select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#5E6D64] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleLocationSearch())}
                    placeholder="Search town, district, or village (e.g., Kitale Kenya, Ejura Ghana)"
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleLocationSearch}
                  disabled={searching}
                  className="px-4 py-2 bg-[#0E4D3A] text-white text-xs font-semibold rounded-lg hover:bg-[#0A3A2B] whitespace-nowrap"
                >
                  {searching ? 'Locating...' : 'Search Location'}
                </button>
              </div>

              {searchMessage && <p className="text-xs text-[#0E4D3A] bg-[#F1F7F4] border border-[#C6D8CE] px-3 py-2 rounded-lg">{searchMessage}</p>}

              <div className="relative rounded-xl overflow-hidden border border-[#D8D2C3] h-72 sm:h-80">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#E2DDD1] rounded-lg p-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[#132A20]">
                    <MapPin className="w-3.5 h-3.5 text-[#0E4D3A]" />
                    Centroid: {centroidLat.toFixed(4)}, {centroidLon.toFixed(4)}
                  </span>
                  <span className="font-mono text-[#132A20]">
                    Vertices: {polygonCoords.length} · Polygon Area: {computedArea > 0 ? `${computedArea} ha` : 'Need ≥3 points'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPolygonCoords((prev) => prev.slice(0, -1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#D8D2C3] hover:bg-[#F2EFE7] font-medium"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Undo Point
                  </button>
                  <button
                    type="button"
                    onClick={() => setPolygonCoords([])}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#E5B8B0] text-[#8C2D19] hover:bg-[#FDF2F0] font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear Boundary
                  </button>
                </div>
              </div>
              <p className="text-xs text-[#5E6D64]">
                Click anywhere on the satellite imagery to add boundary corners, or drag existing white corner points to edit your farm outline.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Soil Type / Local Classification</label>
                <select
                  value={soilType}
                  onChange={(e) => setSoilType(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                >
                  <option>Unknown</option>
                  <option>Savanna Ochrosol (Ferric Lixisol)</option>
                  <option>Red Lateritic / Ferralsol</option>
                  <option>Black Cotton Soil (Vertisol)</option>
                  <option>Alluvial Valley Loam (Fluvisol)</option>
                  <option>Plinthosol / Ironpan Savanna</option>
                  <option>Volcanic Highland Nitisol</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Soil Texture</label>
                <select
                  value={soilTexture}
                  onChange={(e) => setSoilTexture(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                >
                  <option>Unknown</option>
                  <option>Sandy</option>
                  <option>Loamy Sand</option>
                  <option>Sandy Loam</option>
                  <option>Loam</option>
                  <option>Clay Loam</option>
                  <option>Heavy Clay</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Drainage Behavior</label>
                <select
                  value={drainage}
                  onChange={(e) => setDrainage(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                >
                  <option>Unknown</option>
                  <option>Excessively drained (dries rapidly)</option>
                  <option>Well-drained</option>
                  <option>Moderately well-drained</option>
                  <option>Poorly drained / seasonal waterlogging</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Observed Soil Fertility</label>
                <select
                  value={soilFertility}
                  onChange={(e) => setSoilFertility(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                >
                  <option>Unknown</option>
                  <option>Low (stunted growth without fertilizer)</option>
                  <option>Moderate (declining after continuous cropping)</option>
                  <option>Good (dark topsoil, vigorous crop growth)</option>
                </select>
              </div>

              <div className="bg-white border border-[#E2DDD1] rounded-lg p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-[#2E3E35]">Soil Organic Matter (%)</label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#5A665E] cursor-pointer">
                    <input type="checkbox" checked={omUnknown} onChange={(e) => setOmUnknown(e.target.checked)} />
                    Unknown / Not tested
                  </label>
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="15"
                  disabled={omUnknown}
                  value={organicMatterPct}
                  onChange={(e) => setOrganicMatterPct(e.target.value)}
                  placeholder={omUnknown ? 'Marked as Unknown' : 'e.g., 1.8'}
                  className="w-full px-3 py-2 text-sm font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg disabled:opacity-50"
                />
              </div>

              <div className="bg-white border border-[#E2DDD1] rounded-lg p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-[#2E3E35]">Soil pH (if known)</label>
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#5A665E] cursor-pointer">
                    <input type="checkbox" checked={phUnknown} onChange={(e) => setPhUnknown(e.target.checked)} />
                    Unknown / Not tested
                  </label>
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="3.5"
                  max="9.0"
                  disabled={phUnknown}
                  value={soilPh}
                  onChange={(e) => setSoilPh(e.target.value)}
                  placeholder={phUnknown ? 'Marked as Unknown' : 'e.g., 6.1'}
                  className="w-full px-3 py-2 text-sm font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg disabled:opacity-50"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Irrigation Availability</label>
                <select
                  value={irrigationAvailable}
                  onChange={(e) => setIrrigationAvailable(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                >
                  <option>None (strictly rainfed)</option>
                  <option>Supplemental dry-spell watering (manual / treadle pump)</option>
                  <option>Seasonal stream / small dam gravity irrigation</option>
                  <option>Borehole / motorized drip or sprinkler</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Local Soil Observations (optional)</label>
                <textarea
                  rows={2}
                  value={soilNotes}
                  onChange={(e) => setSoilNotes(e.target.value)}
                  placeholder="e.g., Crusting after hard rains, rocky ridge on western edge..."
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">Previous Crops (last 1–3 seasons)</label>
                <div className="flex flex-wrap gap-1.5">
                  {cropNames.map((c) => {
                    const active = previousCrops.includes(c);
                    return (
                      <button
                        key={`prev-${c}`}
                        type="button"
                        onClick={() => toggleListValue(previousCrops, setPreviousCrops, c)}
                        className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                          active ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]' : 'bg-white text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">Current Crops on Plot</label>
                <div className="flex flex-wrap gap-1.5">
                  {cropNames.map((c) => {
                    const active = currentCrops.includes(c);
                    return (
                      <button
                        key={`curr-${c}`}
                        type="button"
                        onClick={() => toggleListValue(currentCrops, setCurrentCrops, c)}
                        className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                          active ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]' : 'bg-white text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">Planned Future Crops</label>
                <div className="flex flex-wrap gap-1.5">
                  {cropNames.map((c) => {
                    const active = plannedCrops.includes(c);
                    return (
                      <button
                        key={`plan-${c}`}
                        type="button"
                        onClick={() => toggleListValue(plannedCrops, setPlannedCrops, c)}
                        className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                          active ? 'bg-[#B8862D] text-white border-[#B8862D]' : 'bg-white text-[#2E3E35] border-[#D8D2C3] hover:border-[#B8862D]'
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Planting Seasons</label>
                  <input
                    type="text"
                    value={plantingSeasons}
                    onChange={(e) => setPlantingSeasons(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Typical Harvest Periods</label>
                  <input
                    type="text"
                    value={harvestPeriods}
                    onChange={(e) => setHarvestPeriods(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Known Pest, Weed, or Disease Problems</label>
                  <input
                    type="text"
                    value={pestHistory}
                    onChange={(e) => setPestHistory(e.target.value)}
                    placeholder="e.g., Striga weed, Fall Armyworm, root-knot nematodes..."
                    className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Available Equipment & Labor Notes</label>
                  <input
                    type="text"
                    value={equipmentNotes}
                    onChange={(e) => setEquipmentNotes(e.target.value)}
                    placeholder="e.g., Hand hoe, shared tractor tillage, no planter..."
                    className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Local Market Preferences</label>
                  <input
                    type="text"
                    value={marketPreferences}
                    onChange={(e) => setMarketPreferences(e.target.value)}
                    placeholder="e.g., Strong demand for maize, cowpea, soybean, or livestock fodder"
                    className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <p className="text-sm text-[#44544B] mb-4">
                Select the farming priorities that matter most for this plot. The rotation engine uses these priorities to explain trade-offs across strategies.
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {PRIORITY_OPTIONS.map((p) => {
                  const selected = priorities.includes(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => toggleListValue(priorities, setPriorities, p)}
                      className={`flex items-center justify-between px-4 py-3 rounded-lg border text-left text-sm transition-colors ${
                        selected
                          ? 'bg-[#0E4D3A] text-[#FAF8F3] border-[#0E4D3A] font-medium'
                          : 'bg-white text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                      }`}
                    >
                      <span>{p}</span>
                      {selected && <Check className="w-4 h-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <div className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-4 text-sm">
                <div className="grid sm:grid-cols-2 gap-4 pb-4 border-b border-[#ECE8DD]">
                  <div>
                    <div className="text-xs text-[#5E6D64]">Farm Identity</div>
                    <div className="font-semibold text-[#132A20] mt-0.5">{name || 'Unnamed Farm'}</div>
                    <div className="text-xs text-[#44544B]">
                      {district ? `${district}, ` : ''}{region}, {country} · {sizeHectares} ha
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5E6D64]">Geographic Boundary</div>
                    <div className="font-mono text-xs text-[#132A20] mt-0.5">
                      {centroidLat.toFixed(4)}, {centroidLon.toFixed(4)}
                    </div>
                    <div className="text-xs text-[#44544B]">{polygonCoords.length} boundary vertices ({farmingType})</div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 pb-4 border-b border-[#ECE8DD]">
                  <div>
                    <div className="text-xs text-[#5E6D64]">Soil & Irrigation</div>
                    <div className="text-[#132A20] mt-0.5">
                      {soilType} · {soilTexture} · {drainage}
                    </div>
                    <div className="text-xs text-[#44544B] mt-0.5">
                      Fertility: {soilFertility} · pH: {phUnknown || !soilPh ? 'Unknown (flagged for testing)' : soilPh} · OM:{' '}
                      {omUnknown || !organicMatterPct ? 'Unknown' : `${organicMatterPct}%`}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5E6D64]">Crop History</div>
                    <div className="text-xs text-[#132A20] mt-0.5">Previous: {previousCrops.join(', ') || 'None'}</div>
                    <div className="text-xs text-[#132A20]">Current: {currentCrops.join(', ') || 'None'}</div>
                    <div className="text-xs text-[#44544B]">Planned: {plannedCrops.join(', ') || 'None'}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-[#5E6D64] mb-1">Selected Farmer Priorities ({priorities.length})</div>
                  <div className="text-xs text-[#132A20]">{priorities.join(' · ') || 'None selected'}</div>
                </div>
              </div>
              <p className="text-xs text-[#5E6D64]">
                Saving this farm will immediately query live NASA POWER meteorology, GPM precipitation heritage, SMAP root-zone wetness, and SRTM elevation for your registered coordinates.
              </p>
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="px-4 sm:px-6 py-3 sm:py-4 bg-white border-t border-[#E2DDD1] flex flex-wrap items-center justify-between gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={step === 1}
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              className="inline-flex items-center gap-1 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border border-[#D8D2C3] text-[#2E3E35] hover:bg-[#F2EFE7] disabled:opacity-40"
            >
              <ArrowLeft className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Back
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="px-2.5 sm:px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg text-[#5E6D64] hover:text-[#132A20] hover:bg-[#F2EFE7] transition-colors"
              >
                Exit
              </button>
            )}
          </div>

          {step < 6 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && (!name.trim() || !country.trim() || !region.trim())) {
                  setError('Please enter a farm name, country, and region before continuing.');
                  return;
                }
                setError(null);
                setStep((s) => Math.min(6, s + 1));
              }}
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-[#0E4D3A] text-[#FAF8F3] hover:bg-[#0A3A2B]"
            >
              Continue <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={handleSubmit}
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2 text-xs sm:text-sm font-semibold rounded-lg bg-[#0E4D3A] text-[#FAF8F3] hover:bg-[#0A3A2B] disabled:opacity-60"
            >
              <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              {saving ? 'Saving...' : initialFarm ? 'Save Changes' : 'Save Farm'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
