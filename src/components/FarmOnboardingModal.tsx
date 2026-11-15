import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { ArrowLeft, ArrowRight, Check, Crosshair, MapPin, Plus, Search, Trash2, Undo2, X } from 'lucide-react';
import type { Crop, Farm, GeoPoint } from '../types';

interface Props {
  initialFarm?: Farm | null;
  crops: Crop[];
  onSave: (payload: Partial<Farm>, existingId?: string) => Promise<void>;
  onClose?: () => void;
  isFirstOnboarding?: boolean;
}

interface SimpleOption {
  value: string;
  label: string;
  hint?: string;
}

const FARMING_TYPE_OPTIONS: SimpleOption[] = [
  {
    value: 'Rainfed mixed cereal-legume smallholder',
    label: 'Food crops with rainfall',
    hint: 'Grains, maize, beans, rice, or vegetables watered by rain',
  },
  {
    value: 'Crop-livestock integrated farm',
    label: 'Crops + farm animals',
    hint: 'Growing crops and raising cattle, goats, sheep, or poultry',
  },
  {
    value: 'Root & tuber transitional plot',
    label: 'Root & tuber crops',
    hint: 'Cassava, yam, potatoes, sweet potatoes, or taro',
  },
  {
    value: 'Irrigated commercial vegetable & grain',
    label: 'Watered / irrigated farming',
    hint: 'Using pumps, drip pipes, streams, or sprinklers',
  },
  {
    value: 'Agroforestry / conservation agriculture',
    label: 'Trees & crops together',
    hint: 'Fruit, cocoa, coffee, nut, or shade trees with crops',
  },
];

const SOIL_COLOR_OPTIONS: SimpleOption[] = [
  { value: 'Unknown', label: "I'm not sure" },
  { value: 'Dark Loam / Rich Topsoil', label: 'Dark brown or black' },
  { value: 'Red Lateritic / Ferralsol', label: 'Red or reddish-brown' },
  { value: 'Light Sandy Savanna Soil', label: 'Light brown or sandy tan' },
  { value: 'Black Cotton Soil (Vertisol)', label: 'Grey or heavy dark clay' },
];

const SOIL_FEEL_OPTIONS: SimpleOption[] = [
  { value: 'Unknown', label: "I'm not sure" },
  { value: 'Sandy', label: 'Loose & gritty (Sandy)' },
  { value: 'Sandy Loam', label: 'Soft & crumbly (Mixed sand & earth)' },
  { value: 'Loam', label: 'Rich & balanced (Soft garden soil)' },
  { value: 'Clay Loam', label: 'Sticky when wet, hard when dry (Clay)' },
];

const DRAINAGE_OPTIONS: SimpleOption[] = [
  { value: 'Unknown', label: "I'm not sure" },
  { value: 'Excessively drained (dries rapidly)', label: 'Water disappears fast; soil dries quickly' },
  { value: 'Well-drained', label: 'Soaks in well; no standing puddles' },
  { value: 'Poorly drained / seasonal waterlogging', label: 'Water sits in puddles after heavy rain' },
];

const FERTILITY_OPTIONS: SimpleOption[] = [
  { value: 'Unknown', label: "I'm not sure" },
  { value: 'Low (stunted growth without fertilizer)', label: 'Crops stay small or yellow without fertilizer' },
  { value: 'Moderate (declining after continuous cropping)', label: 'Used to grow well, getting weaker over time' },
  { value: 'Good (dark topsoil, vigorous crop growth)', label: 'Crops grow strong and green naturally' },
];

const WATER_SOURCE_OPTIONS: SimpleOption[] = [
  { value: 'None (strictly rainfed)', label: 'Rain only (no watering equipment)' },
  { value: 'Supplemental dry-spell watering (manual / treadle pump)', label: 'Buckets / watering cans in dry spells' },
  { value: 'Seasonal stream / small dam gravity irrigation', label: 'Stream, river, pond, or canal' },
  { value: 'Borehole / motorized drip or sprinkler', label: 'Water pump, drip lines, or sprinklers' },
];

const PLANTING_SEASON_PRESETS = [
  'Once a year when main rains start',
  'Twice a year (main + short rainy season)',
  'Year-round (with watering/irrigation)',
];

const COMMON_PEST_CHIPS = [
  'Caterpillars / armyworm',
  'Stubborn weeds',
  'Leaf insects / aphids',
  'Plant rot or leaf spots',
  'Birds or rodents',
  'No major problems',
];

const COMMON_TOOL_CHIPS = [
  'Hand tools (hoe / cutlass)',
  'Animal plow',
  'Rented tractor',
  'Own tractor / planter',
];

const COMMON_MARKET_CHIPS = [
  'Family food',
  'Local village market',
  'Co-op / commercial buyer',
  'Animal feed / fodder',
];

const PRIORITY_CARDS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'Improving soil health', label: 'Make soil richer & stronger', hint: 'Build up tired land for better harvests' },
  { value: 'Conserving water', label: 'Hold moisture in dry spells', hint: 'Keep roots watered longer between rains' },
  { value: 'Adapting to changing rainfall', label: 'Handle unpredictable rain', hint: 'Crops that cope with late or uneven rain' },
  { value: 'Reducing pest pressure', label: 'Cut down pests & weeds', hint: 'Break insect and weed cycles naturally' },
  { value: 'Reducing erosion', label: 'Stop soil washing away', hint: 'Protect topsoil during heavy downpours' },
  { value: 'Improving nutrient cycling', label: 'Need less bought fertilizer', hint: 'Use beans & legumes to feed the soil' },
  { value: 'Increasing organic matter', label: 'Build dark, living topsoil', hint: 'Leave crop stalks & cover roots in soil' },
  { value: 'Reducing heat-related crop vulnerability', label: 'Protect crops from extreme heat', hint: 'Choose varieties & windows that handle hot days' },
  { value: 'Improving forage availability', label: 'Grow feed for farm animals', hint: 'Produce grain plus stalks or fodder for livestock' },
  { value: 'Market suitability', label: 'Grow crops that sell well', hint: 'Focus on strong local demand and fair income' },
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

function toggleCommaTag(currentText: string, tag: string): string {
  const parts = currentText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const exists = parts.some((p) => p.toLowerCase() === tag.toLowerCase());
  const next = exists ? parts.filter((p) => p.toLowerCase() !== tag.toLowerCase()) : [...parts, tag];
  return next.join(', ');
}

function hasCommaTag(currentText: string, tag: string): boolean {
  return currentText
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(tag.toLowerCase());
}

export function FarmOnboardingModal({ initialFarm, crops, onSave, onClose, isFirstOnboarding }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Basic Farm Info
  const [name, setName] = useState(initialFarm?.name ?? '');
  const [country, setCountry] = useState(initialFarm?.country ?? '');
  const [region, setRegion] = useState(initialFarm?.region ?? '');
  const [district, setDistrict] = useState(initialFarm?.district ?? '');
  const [sizeUnit, setSizeUnit] = useState<'ha' | 'acres'>('ha');
  const [sizeInput, setSizeInput] = useState<string>(initialFarm ? String(initialFarm.sizeHectares) : '2.0');
  const [farmingType, setFarmingType] = useState(
    initialFarm?.farmingType ?? 'Rainfed mixed cereal-legume smallholder'
  );

  // Step 2: Geographic Location & Polygon
  const [polygonCoords, setPolygonCoords] = useState<GeoPoint[]>(
    initialFarm?.polygonCoords?.length
      ? initialFarm.polygonCoords
      : [
          { lat: 7.3845, lon: -1.368 },
          { lat: 7.3845, lon: -1.3654 },
          { lat: 7.3821, lon: -1.3654 },
          { lat: 7.3821, lon: -1.368 },
        ]
  );
  const [centroidLat, setCentroidLat] = useState<number>(initialFarm?.centroidLat ?? 7.3833);
  const [centroidLon, setCentroidLon] = useState<number>(initialFarm?.centroidLon ?? -1.3667);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);

  // Step 3: Simple Soil & Water Questions
  const [soilType, setSoilType] = useState(initialFarm?.soilType ?? 'Unknown');
  const [soilTexture, setSoilTexture] = useState(initialFarm?.soilTexture ?? 'Unknown');
  const [drainage, setDrainage] = useState(initialFarm?.drainage ?? 'Unknown');
  const [soilFertility, setSoilFertility] = useState(initialFarm?.soilFertility ?? 'Unknown');
  const [hasLabTest, setHasLabTest] = useState(
    Boolean(initialFarm && (initialFarm.soilPh !== null || initialFarm.organicMatterPct !== null))
  );
  const [organicMatterPct, setOrganicMatterPct] = useState(
    initialFarm?.organicMatterPct !== null && initialFarm?.organicMatterPct !== undefined
      ? String(initialFarm.organicMatterPct)
      : ''
  );
  const [soilPh, setSoilPh] = useState(
    initialFarm?.soilPh !== null && initialFarm?.soilPh !== undefined ? String(initialFarm.soilPh) : ''
  );
  const [irrigationAvailable, setIrrigationAvailable] = useState(
    initialFarm?.irrigationAvailable ?? 'None (strictly rainfed)'
  );
  const [soilNotes, setSoilNotes] = useState(initialFarm?.soilNotes ?? '');

  // Step 4: Simple Crop History & Farm Habits
  const [previousCrops, setPreviousCrops] = useState<string[]>(initialFarm?.previousCrops ?? ['Maize']);
  const [currentCrops, setCurrentCrops] = useState<string[]>(initialFarm?.currentCrops ?? ['Maize']);
  const [plannedCrops, setPlannedCrops] = useState<string[]>(initialFarm?.plannedCrops ?? ['Cowpea']);
  const [customCropInput, setCustomCropInput] = useState('');
  const [customCrops, setCustomCrops] = useState<string[]>([]);
  const [plantingSeasons, setPlantingSeasons] = useState(
    initialFarm?.plantingSeasons ?? 'Once a year when main rains start'
  );
  const [harvestPeriods, setHarvestPeriods] = useState(initialFarm?.harvestPeriods ?? '');
  const [pestHistory, setPestHistory] = useState(initialFarm?.pestHistory ?? '');
  const [equipmentNotes, setEquipmentNotes] = useState(initialFarm?.equipmentNotes ?? '');
  const [marketPreferences, setMarketPreferences] = useState(initialFarm?.marketPreferences ?? '');

  // Step 5: Farm Goals
  const [priorities, setPriorities] = useState<string[]>(
    initialFarm?.priorities?.length
      ? initialFarm.priorities
      : ['Improving soil health', 'Conserving water', 'Adapting to changing rainfall']
  );

  // Leaflet map refs for Step 2
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  const sizeInHectares = (() => {
    const raw = Number(sizeInput);
    if (!Number.isFinite(raw) || raw <= 0) return 1.0;
    return Number((sizeUnit === 'acres' ? raw * 0.404686 : raw).toFixed(2));
  })();

  function switchSizeUnit(nextUnit: 'ha' | 'acres') {
    if (nextUnit === sizeUnit) return;
    const raw = Number(sizeInput);
    if (Number.isFinite(raw) && raw > 0) {
      const converted = nextUnit === 'acres' ? raw * 2.47105 : raw * 0.404686;
      setSizeInput(converted.toFixed(2));
    }
    setSizeUnit(nextUnit);
  }

  function applyBoxAround(lat: number, lon: number, message: string) {
    setCentroidLat(lat);
    setCentroidLon(lon);
    const d = 0.0011;
    const box = [
      { lat: Number((lat + d).toFixed(5)), lon: Number((lon - d).toFixed(5)) },
      { lat: Number((lat + d).toFixed(5)), lon: Number((lon + d).toFixed(5)) },
      { lat: Number((lat - d).toFixed(5)), lon: Number((lon + d).toFixed(5)) },
      { lat: Number((lat - d).toFixed(5)), lon: Number((lon - d).toFixed(5)) },
    ];
    setPolygonCoords(box);
    const areaHa = computeGeodesicAreaHectares(box);
    if (areaHa > 0) {
      setSizeInput(sizeUnit === 'acres' ? (areaHa * 2.47105).toFixed(2) : String(areaHa));
    }
    mapInstanceRef.current?.setView([lat, lon], 15);
    setSearchMessage(message);
  }

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
        const areaHa = computeGeodesicAreaHectares(next);
        if (areaHa > 0) {
          setSizeInput(sizeUnit === 'acres' ? (areaHa * 2.47105).toFixed(2) : String(areaHa));
        }
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
          const next = prev.map((p, i) =>
            i === idx ? { lat: Number(ll.lat.toFixed(5)), lon: Number(ll.lng.toFixed(5)) } : p
          );
          const c = computeCentroid(next);
          setCentroidLat(c.lat);
          setCentroidLon(c.lon);
          const areaHa = computeGeodesicAreaHectares(next);
          if (areaHa > 0) {
            setSizeInput(sizeUnit === 'acres' ? (areaHa * 2.47105).toFixed(2) : String(areaHa));
          }
          return next;
        });
      });
    });
  }, [polygonCoords, step, sizeUnit]);

  async function handleLocationSearch(overrideQuery?: string) {
    const q = (overrideQuery ?? searchQuery).trim();
    if (!q) return;
    setSearching(true);
    setSearchMessage(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
      );
      const list = (await res.json()) as any[];
      if (list.length === 0) {
        setSearchMessage('Location not found. Try typing just your town and country (e.g. "Nakuru, Kenya").');
        return;
      }
      const hit = list[0];
      const lat = Number(Number(hit.lat).toFixed(5));
      const lon = Number(Number(hit.lon).toFixed(5));
      applyBoxAround(
        lat,
        lon,
        `Map moved to ${hit.display_name.split(',').slice(0, 2).join(', ')}. Drag the white corner dots or tap the map to trace your field.`
      );
    } catch {
      setSearchMessage('Could not search right now — tap directly on the map to mark your land.');
    } finally {
      setSearching(false);
    }
  }

  function handleUseGps() {
    if (!navigator.geolocation) {
      setSearchMessage('GPS is not available on this device. Search your town or tap the map instead.');
      return;
    }
    setLocatingGps(true);
    setSearchMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lon = Number(pos.coords.longitude.toFixed(5));
        applyBoxAround(
          lat,
          lon,
          'Map centered on your current GPS location. Drag the white corner dots to match your field edges.'
        );
        setLocatingGps(false);
      },
      () => {
        setSearchMessage('Location permission was declined or unavailable. Search your village or town above instead.');
        setLocatingGps(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }

  function toggleListValue(list: string[], setList: (v: string[]) => void, val: string) {
    setList(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  }

  function addCustomCrop() {
    const cleaned = customCropInput.trim();
    if (!cleaned) return;
    if (!cropChoices.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      setCustomCrops((prev) => [...prev, cleaned]);
    }
    if (!currentCrops.some((c) => c.toLowerCase() === cleaned.toLowerCase())) {
      setCurrentCrops((prev) => [...prev, cleaned]);
    }
    setCustomCropInput('');
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
          sizeHectares: sizeInHectares,
          farmingType,
          centroidLat,
          centroidLon,
          polygonCoords,
          soilType,
          soilTexture,
          drainage,
          soilFertility,
          organicMatterPct: !hasLabTest || organicMatterPct.trim() === '' ? null : Number(organicMatterPct),
          soilPh: !hasLabTest || soilPh.trim() === '' ? null : Number(soilPh),
          irrigationAvailable,
          soilNotes,
          previousCrops,
          currentCrops,
          plannedCrops,
          plantingSeasons: plantingSeasons.trim() || 'Once a year when main rains start',
          harvestPeriods: harvestPeriods.trim() || 'Seasonal harvest',
          pestHistory,
          availableWater: irrigationAvailable,
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

  const baseCropNames =
    crops.length > 0
      ? crops.map((c) => c.name)
      : [
          'Maize',
          'Rice',
          'Wheat',
          'Beans / Cowpea',
          'Soybean',
          'Groundnut',
          'Sorghum',
          'Millet',
          'Cassava',
          'Potato / Yam',
          'Tomato / Vegetables',
          'Pigeon Pea',
        ];
  const cropChoices = Array.from(
    new Set([...baseCropNames, ...customCrops, ...previousCrops, ...currentCrops, ...plannedCrops])
  );
  const computedArea = computeGeodesicAreaHectares(polygonCoords);

  const stepLabels = ['About Farm', 'Find on Map', 'Soil & Water', 'Your Crops', 'Your Goals', 'Save Farm'];

  const renderSimpleCardGroup = (
    title: string,
    subtitle: string,
    options: SimpleOption[],
    selectedValue: string,
    onSelect: (v: string) => void
  ) => (
    <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-2.5">
      <div>
        <div className="text-xs font-semibold text-[#132A20]">{title}</div>
        <div className="text-[11px] text-[#5E6D64] mt-0.5">{subtitle}</div>
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {options.map((opt) => {
          const active = selectedValue === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(opt.value)}
              className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-colors flex items-start justify-between gap-2 ${
                active
                  ? 'bg-[#0E4D3A] text-[#FAF8F3] border-[#0E4D3A] font-medium'
                  : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
              }`}
            >
              <div>
                <div>{opt.label}</div>
                {opt.hint && (
                  <div className={`text-[11px] mt-0.5 ${active ? 'text-[#D6E8DF]' : 'text-[#5E6D64]'}`}>
                    {opt.hint}
                  </div>
                )}
              </div>
              {active && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-[#132A20]/55 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-[#FAF8F3] border border-[#DFD9CB] rounded-xl w-full max-w-4xl max-h-[95dvh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-white border-b border-[#E2DDD1] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-semibold text-[#132A20] truncate">
              {initialFarm
                ? `Edit Farm: ${initialFarm.name}`
                : isFirstOnboarding
                ? 'Tell Us About Your Farm'
                : 'Add a New Farm'}
            </h2>
            <p className="text-xs text-[#5E6D64] mt-0.5">
              Question Set {step} of 6 · {stepLabels[step - 1]}
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
                onClick={() => {
                  if (num > 1 && (!name.trim() || !country.trim() || !region.trim())) {
                    setError('Please enter your farm name, country, and region first.');
                    return;
                  }
                  setError(null);
                  setStep(num);
                }}
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
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {error && (
            <div className="p-3 rounded-lg bg-[#FDF2F0] border border-[#E5B8B0] text-xs text-[#8C2D19]">{error}</div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="bg-[#F1F7F4] border border-[#C6D8CE] rounded-lg px-4 py-3 text-xs text-[#132A20]">
                Answer these simple questions in everyday words. If you are not sure about any detail later on, you can choose <strong>&ldquo;I&apos;m not sure&rdquo;</strong> and update it anytime.
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">
                    1. What do you call this farm or plot? *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Family Maize Field, River Plot, or South Farm"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">
                    2. Which country is your farm in? *
                  </label>
                  <input
                    type="text"
                    required
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="e.g., Kenya, India, Brazil, Ghana, United States"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">
                    3. Which state, region, or province? *
                  </label>
                  <input
                    type="text"
                    required
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="e.g., Rift Valley, Punjab, Iowa, Ashanti"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">
                    4. Nearest village, town, or district (optional)
                  </label>
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="Helps locate your local weather"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-[#2E3E35]">5. About how big is the land?</label>
                    <div className="inline-flex rounded-md border border-[#D8D2C3] bg-white overflow-hidden text-[11px]">
                      <button
                        type="button"
                        onClick={() => switchSizeUnit('ha')}
                        className={`px-2 py-0.5 font-medium ${sizeUnit === 'ha' ? 'bg-[#0E4D3A] text-white' : 'text-[#5E6D64]'}`}
                      >
                        Hectares
                      </button>
                      <button
                        type="button"
                        onClick={() => switchSizeUnit('acres')}
                        className={`px-2 py-0.5 font-medium ${sizeUnit === 'acres' ? 'bg-[#0E4D3A] text-white' : 'text-[#5E6D64]'}`}
                      >
                        Acres
                      </button>
                    </div>
                  </div>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={sizeInput}
                    onChange={(e) => setSizeInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                  <p className="text-[11px] text-[#5E6D64] mt-1">
                    {sizeUnit === 'acres'
                      ? `Equals about ${sizeInHectares} hectares`
                      : `Equals about ${(sizeInHectares * 2.47105).toFixed(1)} acres (1 hectare ≈ 2.5 acres)`}
                  </p>
                </div>
              </div>

              {renderSimpleCardGroup(
                '6. What kind of farming do you mainly do here?',
                'Pick the description that fits your land best.',
                FARMING_TYPE_OPTIONS,
                farmingType,
                setFarmingType
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="bg-[#F1F7F4] border border-[#C6D8CE] rounded-lg px-4 py-3 text-xs text-[#132A20]">
                Search your village or town below — or tap <strong>&ldquo;Use My GPS&rdquo;</strong> if you are standing on your farm. Then tap the corners of your field on the map.
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-[#5E6D64] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleLocationSearch())}
                    placeholder={`Search village or town (e.g., ${district || region || 'Nakuru'}, ${country || 'Kenya'})`}
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleLocationSearch()}
                    disabled={searching}
                    className="flex-1 sm:flex-initial px-4 py-2 bg-[#0E4D3A] text-white text-xs font-semibold rounded-lg hover:bg-[#0A3A2B] whitespace-nowrap"
                  >
                    {searching ? 'Finding...' : 'Find Place'}
                  </button>
                  <button
                    type="button"
                    onClick={handleUseGps}
                    disabled={locatingGps}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white border border-[#0E4D3A] text-[#0E4D3A] text-xs font-semibold rounded-lg hover:bg-[#F1F7F4] whitespace-nowrap"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    {locatingGps ? 'Locating...' : 'Use My GPS'}
                  </button>
                </div>
              </div>

              {searchMessage && (
                <p className="text-xs text-[#0E4D3A] bg-[#F1F7F4] border border-[#C6D8CE] px-3 py-2 rounded-lg">
                  {searchMessage}
                </p>
              )}

              <div className="relative rounded-xl overflow-hidden border border-[#D8D2C3] h-72 sm:h-80">
                <div ref={mapContainerRef} className="w-full h-full" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#E2DDD1] rounded-lg p-3 text-xs">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[#132A20]">
                    <MapPin className="w-3.5 h-3.5 text-[#0E4D3A]" />
                    Map Pin: {centroidLat.toFixed(4)}, {centroidLon.toFixed(4)}
                  </span>
                  <span className="font-mono text-[#132A20]">
                    Corners: {polygonCoords.length} · Measured Size:{' '}
                    {computedArea > 0 ? `${computedArea} ha (${(computedArea * 2.47105).toFixed(1)} ac)` : 'Tap ≥3 corners'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPolygonCoords((prev) => prev.slice(0, -1))}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#D8D2C3] hover:bg-[#F2EFE7] font-medium"
                  >
                    <Undo2 className="w-3.5 h-3.5" /> Undo Corner
                  </button>
                  <button
                    type="button"
                    onClick={() => setPolygonCoords([])}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-[#E5B8B0] text-[#8C2D19] hover:bg-[#FDF2F0] font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear Map
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-[#F1F7F4] border border-[#C6D8CE] rounded-lg px-4 py-3 text-xs text-[#132A20]">
                No lab equipment needed — just tell us how your soil looks and behaves after rain. Pick <strong>&ldquo;I&apos;m not sure&rdquo;</strong> if you don&apos;t know.
              </div>

              {renderSimpleCardGroup(
                '1. What color is your soil mostly?',
                'Look at dry topsoil on your plot.',
                SOIL_COLOR_OPTIONS,
                soilType,
                setSoilType
              )}

              {renderSimpleCardGroup(
                '2. How does the soil feel in your hand?',
                'Rub a pinch of soil between your fingers.',
                SOIL_FEEL_OPTIONS,
                soilTexture,
                setSoilTexture
              )}

              {renderSimpleCardGroup(
                '3. What happens when heavy rain falls?',
                'Think about puddles and how fast the ground dries.',
                DRAINAGE_OPTIONS,
                drainage,
                setDrainage
              )}

              {renderSimpleCardGroup(
                '4. How well do crops grow without extra fertilizer?',
                'Think about harvest strength on this plot in normal years.',
                FERTILITY_OPTIONS,
                soilFertility,
                setSoilFertility
              )}

              {renderSimpleCardGroup(
                '5. How do your crops get water?',
                'Choose your main source of water during the growing season.',
                WATER_SOURCE_OPTIONS,
                irrigationAvailable,
                setIrrigationAvailable
              )}

              {/* Optional Lab Results */}
              <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[#132A20]">
                      6. Have you ever had a laboratory soil test? (Optional)
                    </div>
                    <div className="text-[11px] text-[#5E6D64]">
                      Most farmers skip this — leave unchecked if you don&apos;t have test numbers.
                    </div>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#0E4D3A] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasLabTest}
                      onChange={(e) => setHasLabTest(e.target.checked)}
                    />
                    Yes, I have soil test numbers
                  </label>
                </div>

                {hasLabTest && (
                  <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-[#ECE8DD]">
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Soil pH (e.g., 6.2)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="3.5"
                        max="9.0"
                        value={soilPh}
                        onChange={(e) => setSoilPh(e.target.value)}
                        placeholder="e.g., 6.1"
                        className="w-full px-3 py-2 text-sm font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Organic Matter % (e.g., 1.8)</label>
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        max="15"
                        value={organicMatterPct}
                        onChange={(e) => setOrganicMatterPct(e.target.value)}
                        placeholder="e.g., 1.8"
                        className="w-full px-3 py-2 text-sm font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#2E3E35] mb-1">
                  7. Anything else you notice about your ground? (Optional)
                </label>
                <textarea
                  rows={2}
                  value={soilNotes}
                  onChange={(e) => setSoilNotes(e.target.value)}
                  placeholder="e.g., Rocky on one side, hard crust after rain, gentle slope..."
                  className="w-full px-3 py-2 text-sm bg-white border border-[#D8D2C3] rounded-lg"
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              {/* Custom crop adder */}
              <div className="bg-white border border-[#E2DDD1] rounded-xl p-4 space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#132A20] mb-1">
                    Don&apos;t see your crop below? Add it here
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customCropInput}
                      onChange={(e) => setCustomCropInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomCrop())}
                      placeholder="e.g., Wheat, Coffee, Onion, Cocoa, Sunflower..."
                      className="flex-1 px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                    />
                    <button
                      type="button"
                      onClick={addCustomCrop}
                      className="inline-flex items-center gap-1 px-3.5 py-2 rounded-lg bg-[#0E4D3A] text-white text-xs font-semibold hover:bg-[#0A3A2B]"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Crop
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    1. What did you grow on this land before? (Last 1–3 seasons)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {cropChoices.map((c) => {
                      const active = previousCrops.includes(c);
                      return (
                        <button
                          key={`prev-${c}`}
                          type="button"
                          onClick={() => toggleListValue(previousCrops, setPreviousCrops, c)}
                          className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    2. What is growing on the land right now?
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCurrentCrops([])}
                      className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                        currentCrops.length === 0
                          ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                          : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                      }`}
                    >
                      Empty / Resting (Fallow)
                    </button>
                    {cropChoices.map((c) => {
                      const active = currentCrops.includes(c);
                      return (
                        <button
                          key={`curr-${c}`}
                          type="button"
                          onClick={() => toggleListValue(currentCrops, setCurrentCrops, c)}
                          className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    3. What would you like to plant next?
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {cropChoices.map((c) => {
                      const active = plannedCrops.includes(c);
                      return (
                        <button
                          key={`plan-${c}`}
                          type="button"
                          onClick={() => toggleListValue(plannedCrops, setPlannedCrops, c)}
                          className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#8A621C] text-white border-[#8A621C]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3] hover:border-[#8A621C]'
                          }`}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 bg-white border border-[#E2DDD1] rounded-xl p-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    4. How many times a year do you usually plant?
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {PLANTING_SEASON_PRESETS.map((preset) => {
                      const active = plantingSeasons === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setPlantingSeasons(preset)}
                          className={`px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                          }`}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={plantingSeasons}
                    onChange={(e) => setPlantingSeasons(e.target.value)}
                    placeholder="Or write your planting months (e.g., March–June)"
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1">
                    5. When do you normally harvest? (Optional)
                  </label>
                  <input
                    type="text"
                    value={harvestPeriods}
                    onChange={(e) => setHarvestPeriods(e.target.value)}
                    placeholder="e.g., August and December, or about 3 months after planting"
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    6. Any pests, weeds, or crop sicknesses you notice often?
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {COMMON_PEST_CHIPS.map((chip) => {
                      const active = hasCommaTag(pestHistory, chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setPestHistory((prev) => toggleCommaTag(prev, chip))}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3]'
                          }`}
                        >
                          {chip}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={pestHistory}
                    onChange={(e) => setPestHistory(e.target.value)}
                    placeholder="Type any other pest, weed, or plant disease..."
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    7. What tools do you use on the land?
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {COMMON_TOOL_CHIPS.map((chip) => {
                      const active = hasCommaTag(equipmentNotes, chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setEquipmentNotes((prev) => toggleCommaTag(prev, chip))}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3]'
                          }`}
                        >
                          {chip}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={equipmentNotes}
                    onChange={(e) => setEquipmentNotes(e.target.value)}
                    placeholder="Other tools..."
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">
                    8. Who do you mainly grow crops for?
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {COMMON_MARKET_CHIPS.map((chip) => {
                      const active = hasCommaTag(marketPreferences, chip);
                      return (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => setMarketPreferences((prev) => toggleCommaTag(prev, chip))}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0E4D3A] text-white border-[#0E4D3A]'
                              : 'bg-[#FAF8F3] text-[#2E3E35] border-[#D8D2C3]'
                          }`}
                        >
                          {chip}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={marketPreferences}
                    onChange={(e) => setMarketPreferences(e.target.value)}
                    placeholder="Other buyers or goals..."
                    className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-[#44544B]">
                Tap the goals that matter most for your farm. We use your choices to recommend crop sequences that fit your priorities.
              </p>
              <div className="grid sm:grid-cols-2 gap-2.5">
                {PRIORITY_CARDS.map((card) => {
                  const selected = priorities.includes(card.value);
                  return (
                    <button
                      key={card.value}
                      type="button"
                      onClick={() => toggleListValue(priorities, setPriorities, card.value)}
                      className={`flex items-start justify-between gap-2 px-4 py-3 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'bg-[#0E4D3A] text-[#FAF8F3] border-[#0E4D3A]'
                          : 'bg-white text-[#2E3E35] border-[#D8D2C3] hover:border-[#0E4D3A]'
                      }`}
                    >
                      <div>
                        <div className="text-sm font-medium">{card.label}</div>
                        <div className={`text-xs mt-0.5 ${selected ? 'text-[#D6E8DF]' : 'text-[#5E6D64]'}`}>
                          {card.hint}
                        </div>
                      </div>
                      {selected && <Check className="w-4 h-4 shrink-0 mt-0.5" />}
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
                    <div className="text-xs text-[#5E6D64]">Farm Name & Place</div>
                    <div className="font-semibold text-[#132A20] mt-0.5">{name || 'Unnamed Farm'}</div>
                    <div className="text-xs text-[#44544B]">
                      {district ? `${district}, ` : ''}
                      {region}, {country} · {sizeInHectares} ha ({(sizeInHectares * 2.47105).toFixed(1)} acres)
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5E6D64]">Map Location & Farming Type</div>
                    <div className="font-mono text-xs text-[#132A20] mt-0.5">
                      {centroidLat.toFixed(4)}, {centroidLon.toFixed(4)} ({polygonCoords.length} corners)
                    </div>
                    <div className="text-xs text-[#44544B]">
                      {FARMING_TYPE_OPTIONS.find((f) => f.value === farmingType)?.label || farmingType}
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4 pb-4 border-b border-[#ECE8DD]">
                  <div>
                    <div className="text-xs text-[#5E6D64]">Soil & Water Answers</div>
                    <div className="text-xs text-[#132A20] mt-0.5">
                      Color: {SOIL_COLOR_OPTIONS.find((o) => o.value === soilType)?.label || soilType} · Feel:{' '}
                      {SOIL_FEEL_OPTIONS.find((o) => o.value === soilTexture)?.label || soilTexture}
                    </div>
                    <div className="text-xs text-[#44544B] mt-0.5">
                      Water:{' '}
                      {WATER_SOURCE_OPTIONS.find((o) => o.value === irrigationAvailable)?.label ||
                        irrigationAvailable}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-[#5E6D64]">Crops</div>
                    <div className="text-xs text-[#132A20] mt-0.5">
                      Before: {previousCrops.join(', ') || 'None listed'}
                    </div>
                    <div className="text-xs text-[#132A20]">
                      Now: {currentCrops.join(', ') || 'Empty / Resting'}
                    </div>
                    <div className="text-xs text-[#44544B]">
                      Planned next: {plannedCrops.join(', ') || 'Open to suggestions'}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-[#5E6D64] mb-1">Your Main Farm Goals ({priorities.length})</div>
                  <div className="text-xs text-[#132A20]">
                    {priorities
                      .map((p) => PRIORITY_CARDS.find((c) => c.value === p)?.label || p)
                      .join(' · ') || 'None selected'}
                  </div>
                </div>
              </div>
              <p className="text-xs text-[#5E6D64]">
                When you save, we will automatically fetch live weather forecasts, hazard alerts, and NASA satellite soil &amp; rainfall data for your field.
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
                  setError('Please enter your farm name, country, and region before continuing.');
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
