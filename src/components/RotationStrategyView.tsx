import React, { useMemo, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Plus, Search, Sprout } from 'lucide-react';
import { api } from '../lib/api';
import type { Crop, IndicatorRating, RotationStrategy, User } from '../types';

interface Props {
  strategies: RotationStrategy[];
  crops: Crop[];
  user: User;
  onCropsChanged: () => Promise<void>;
}

function ratingBadgeStyle(rating: IndicatorRating): string {
  switch (rating) {
    case 'High Benefit':
      return 'text-[#0E4D3A] font-semibold';
    case 'Moderate Benefit':
      return 'text-[#1F6A50] font-semibold';
    case 'Balanced':
      return 'text-[#44544B] font-medium';
    case 'Elevated Demand':
      return 'text-[#9A6A16] font-semibold';
    case 'Higher Risk':
    case 'Needs Validation':
      return 'text-[#9E2F1B] font-semibold';
  }
}

export function RotationStrategyView({ strategies, crops, user, onCropsChanged }: Props) {
  const [selectedStrategyId, setSelectedStrategyId] = useState<'strategy_a' | 'strategy_b' | 'strategy_c'>('strategy_b');
  const [subTab, setSubTab] = useState<'strategies' | 'crops'>('strategies');
  const [cropSearch, setCropSearch] = useState('');
  const [familyFilter, setFamilyFilter] = useState<'all' | 'Legume' | 'Cereal' | 'Root'>('all');
  const [editingCrop, setEditingCrop] = useState<Partial<Crop> | null>(null);
  const [savingCrop, setSavingCrop] = useState(false);
  const [cropErr, setCropErr] = useState<string | null>(null);

  const canEditCrops = user.role === 'expert' || user.role === 'admin';
  const activeStrategy = strategies.find((s) => s.id === selectedStrategyId) ?? strategies[0];

  const filteredCrops = useMemo(() => {
    return crops.filter((c) => {
      const matchesText =
        !cropSearch.trim() ||
        c.name.toLowerCase().includes(cropSearch.toLowerCase()) ||
        c.scientificName.toLowerCase().includes(cropSearch.toLowerCase()) ||
        c.family.toLowerCase().includes(cropSearch.toLowerCase());
      const matchesFam =
        familyFilter === 'all' ||
        (familyFilter === 'Legume' && c.family.toLowerCase().includes('fabaceae')) ||
        (familyFilter === 'Cereal' && c.family.toLowerCase().includes('poaceae')) ||
        (familyFilter === 'Root' && (c.family.toLowerCase().includes('tuber') || c.family.toLowerCase().includes('euphorbiaceae') || c.family.toLowerCase().includes('dioscorea') || c.family.toLowerCase().includes('convolvulaceae')));
      return matchesText && matchesFam;
    });
  }, [crops, cropSearch, familyFilter]);

  async function handleSaveCrop(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCrop) return;
    setCropErr(null);
    setSavingCrop(true);
    try {
      if (editingCrop.id) {
        await api.updateCrop(editingCrop.id, editingCrop);
      } else {
        await api.createCrop(editingCrop);
      }
      await onCropsChanged();
      setEditingCrop(null);
    } catch (err: any) {
      setCropErr(err.message);
    } finally {
      setSavingCrop(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Section Header + Subtab Switch */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#132A20]">
            Crop Rotation Decision Engine & Crop Intelligence
          </h2>
          <p className="text-sm text-[#47564E] mt-1">
            Compare your baseline rotation against two environmentally adapted sequences—grounded in NASA climate observations and your selected priorities.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#EAE4D7] rounded-lg text-xs shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('strategies')}
            className={`px-3.5 py-2 rounded-md font-semibold transition-colors whitespace-nowrap ${
              subTab === 'strategies' ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
            }`}
          >
            Rotation Strategies (3)
          </button>
          <button
            type="button"
            onClick={() => setSubTab('crops')}
            className={`px-3.5 py-2 rounded-md font-semibold transition-colors whitespace-nowrap ${
              subTab === 'crops' ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
            }`}
          >
            Crop Database ({crops.length})
          </button>
        </div>
      </div>

      {subTab === 'strategies' && (
        <>
          {/* 3 Strategy Selector Cards */}
          <div className="grid lg:grid-cols-3 gap-5">
            {strategies.map((strat) => {
              const isSelected = strat.id === activeStrategy.id;
              return (
                <button
                  key={strat.id}
                  type="button"
                  onClick={() => setSelectedStrategyId(strat.id)}
                  className={`text-left rounded-xl p-5 border transition-all flex flex-col justify-between ${
                    isSelected
                      ? 'bg-[#0E4D3A] text-[#FAF8F3] border-[#0E4D3A] shadow-md'
                      : 'bg-white text-[#132A20] border-[#E2DDD1] hover:border-[#0E4D3A]'
                  }`}
                >
                  <div>
                    <div className={`text-xs font-medium ${isSelected ? 'text-[#E4C37A]' : 'text-[#8A621C]'}`}>
                      {strat.label}
                    </div>
                    <h3 className="font-display text-lg font-semibold mt-1">{strat.title}</h3>
                    <p className={`text-xs mt-1.5 leading-relaxed ${isSelected ? 'text-[#DCE8E1]' : 'text-[#47564E]'}`}>
                      {strat.subtitle}
                    </p>
                  </div>

                  <div className={`mt-4 pt-3 border-t text-xs flex items-center justify-between ${isSelected ? 'border-white/15 text-[#FAF8F3]' : 'border-[#ECE8DD] text-[#0E4D3A]'}`}>
                    <span>{strat.steps.length} seasonal phases</span>
                    <span className="font-semibold">{isSelected ? 'Inspecting Below' : 'Inspect Strategy'}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Detailed Active Strategy Breakdown */}
          {activeStrategy && (
            <div className="bg-white border border-[#E2DDD1] rounded-xl p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-4 border-b border-[#ECE8DD]">
                <div>
                  <div className="text-xs font-semibold text-[#8A621C]">{activeStrategy.label} · Detailed Sequence</div>
                  <h3 className="font-display text-xl font-semibold text-[#132A20] mt-0.5">{activeStrategy.title}</h3>
                </div>
                <div className="text-xs text-[#5E6D64]">
                  Qualitative agronomic trade-offs · No fabricated numeric yield scores
                </div>
              </div>

              {/* 4-Season Sequence Grid */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {activeStrategy.steps.map((step, idx) => (
                  <div key={step.seasonLabel} className="bg-[#FAF8F3] border border-[#E2DDD1] rounded-lg p-4 space-y-1.5">
                    <div className="text-[11px] font-mono text-[#5E6D64]">0{idx + 1}. {step.seasonLabel}</div>
                    <div className="font-semibold text-sm text-[#132A20] flex items-center gap-1.5">
                      <Sprout className="w-4 h-4 text-[#0E4D3A] shrink-0" />
                      {step.cropName}
                    </div>
                    <div className="text-xs text-[#5E6D64]">{step.cropFamily}</div>
                    <div className="text-xs text-[#2E3E35] pt-1">
                      <span className="font-medium">Window:</span> {step.plantingWindow} ({step.durationDays})
                    </div>
                    <p className="text-xs text-[#47564E] leading-relaxed pt-1">{step.roleInRotation}</p>
                  </div>
                ))}
              </div>

              {/* Agronomic Explanations */}
              <div className="grid md:grid-cols-2 gap-5 text-xs leading-relaxed">
                <div className="space-y-3">
                  <div>
                    <div className="font-semibold text-[#132A20]">Soil Health & Structure</div>
                    <p className="text-[#44544B] mt-0.5">{activeStrategy.soilHealthBenefits}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-[#132A20]">Nutrient Cycling & Nitrogen</div>
                    <p className="text-[#44544B] mt-0.5">{activeStrategy.nutrientCycling}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-[#132A20]">Water Requirements</div>
                    <p className="text-[#44544B] mt-0.5">{activeStrategy.waterRequirements}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-[#132A20]">Erosion & Organic Matter</div>
                    <p className="text-[#44544B] mt-0.5">
                      {activeStrategy.erosionReduction} {activeStrategy.organicMatterContribution}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="font-semibold text-[#132A20]">Pest & Weed Cycle Disruption</div>
                    <p className="text-[#44544B] mt-0.5">{activeStrategy.pestCycleDisruption}</p>
                  </div>
                  <div>
                    <div className="font-semibold text-[#132A20]">Forage & Market Considerations</div>
                    <p className="text-[#44544B] mt-0.5">
                      {activeStrategy.forageOpportunities} {activeStrategy.marketConsiderations}
                    </p>
                  </div>

                  {/* Risks & Missing Info */}
                  <div className="bg-[#FDF8EE] border border-[#E8D5A7] rounded-lg p-3.5 space-y-2">
                    <div className="font-semibold text-[#7A5210] flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" /> Environmental Risks & Missing Data
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[#5A4218]">
                      {activeStrategy.environmentalRisks.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                      {activeStrategy.missingInformation.map((m) => (
                        <li key={m}>Missing info: {m}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-[#F1F7F4] border border-[#C6D8CE] rounded-lg p-3.5 space-y-1.5">
                    <div className="font-semibold text-[#0E4D3A] flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Required Local Validation Before Planting
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[#2E4D3E]">
                      {activeStrategy.requiredLocalValidation.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Side-by-Side 8-Indicator Comparison Matrix */}
          <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2DDD1] bg-[#FAF8F3]">
              <h3 className="font-display text-lg font-semibold text-[#132A20]">
                Strategy Comparison Matrix Across Your Priorities
              </h3>
              <p className="text-xs text-[#5E6D64] mt-0.5">
                Transparent qualitative assessment across 8 agronomic dimensions. Uncertain parameters are flagged for local verification rather than scored numerically.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#E2DDD1] bg-[#F2EFE7]/70 text-[#2E3E35]">
                    <th className="py-3 px-4 font-semibold w-44">Indicator</th>
                    {strategies.map((s) => (
                      <th key={s.id} className="py-3 px-4 font-semibold">
                        <div>{s.label}</div>
                        <div className="font-normal text-[#5E6D64]">{s.title}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ECE8DD]">
                  {strategies[0]?.indicators.map((ind, idx) => (
                    <tr key={ind.indicator} className="hover:bg-[#FAF8F3]/70 align-top">
                      <td className="py-3.5 px-4 font-semibold text-[#132A20]">{ind.indicator}</td>
                      {strategies.map((s) => {
                        const cell = s.indicators[idx];
                        return (
                          <td key={`${s.id}-${ind.indicator}`} className="py-3.5 px-4 space-y-1">
                            <div className={ratingBadgeStyle(cell.rating)}>{cell.rating}</div>
                            <p className="text-[#47564E] leading-relaxed">{cell.explanation}</p>
                            <p className="text-[11px] text-[#6E7C73]">{cell.alignmentWithPriorities}</p>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Crop Intelligence Database Explorer */}
      {subTab === 'crops' && (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-[#E2DDD1] rounded-xl p-4">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#5E6D64] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={cropSearch}
                onChange={(e) => setCropSearch(e.target.value)}
                placeholder="Search crop name, scientific name, or family..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-[#F2EFE7] rounded-lg text-xs">
                {(['all', 'Legume', 'Cereal', 'Root'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFamilyFilter(f)}
                    className={`px-2.5 py-1 rounded-md font-medium ${
                      familyFilter === f ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
                    }`}
                  >
                    {f === 'all' ? 'All Families' : f === 'Root' ? 'Roots & Tubers' : `${f}s`}
                  </button>
                ))}
              </div>

              {canEditCrops && (
                <button
                  type="button"
                  onClick={() =>
                    setEditingCrop({
                      name: '',
                      scientificName: '',
                      family: 'Fabaceae (Legume)',
                      growingDurationDays: '80–110 days',
                      waterReqMm: '350–550 mm',
                      waterTier: 'Moderate',
                      tempMinC: 14,
                      tempOptMinC: 22,
                      tempOptMaxC: 32,
                      tempMaxC: 38,
                      soilPreference: 'Well-drained sandy loam',
                      phMin: 5.5,
                      phMax: 7.2,
                      rootingDepthCm: '70–120 cm',
                      rootingType: 'Taproot with nodules',
                      nutrientDemand: 'Light',
                      nitrogenFixingKgHa: 60,
                      organicMatterContrib: 'High',
                      foragePotential: 'Dual-purpose residue',
                      pestDiseaseNotes: '',
                      suitableSeasons: 'Main or minor rains',
                    })
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[#0E4D3A] text-[#FAF8F3] hover:bg-[#0A3A2B]"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Crop Profile
                </button>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {filteredCrops.map((crop) => (
              <div key={crop.id} className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-[#5E6D64] font-medium">
                      {crop.family} · <em>{crop.scientificName}</em>
                    </div>
                    <h4 className="font-display text-lg font-semibold text-[#132A20] mt-0.5">{crop.name}</h4>
                  </div>
                  {canEditCrops && (
                    <button
                      type="button"
                      onClick={() => setEditingCrop(crop)}
                      className="text-xs font-semibold text-[#0E4D3A] hover:underline shrink-0"
                    >
                      Edit Entry
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-[#FAF8F3] border border-[#ECE8DD] rounded-lg p-3">
                  <div>
                    <span className="text-[#5E6D64]">Duration:</span>{' '}
                    <span className="font-mono text-[#132A20]">{crop.growingDurationDays}</span>
                  </div>
                  <div>
                    <span className="text-[#5E6D64]">Water:</span>{' '}
                    <span className="font-mono text-[#132A20]">{crop.waterReqMm}</span>
                  </div>
                  <div>
                    <span className="text-[#5E6D64]">Opt Temp:</span>{' '}
                    <span className="font-mono text-[#132A20]">{crop.tempOptMinC}–{crop.tempOptMaxC}°C</span>
                  </div>
                  <div>
                    <span className="text-[#5E6D64]">Soil pH:</span>{' '}
                    <span className="font-mono text-[#132A20]">{crop.phMin}–{crop.phMax}</span>
                  </div>
                  <div>
                    <span className="text-[#5E6D64]">N-Fixation:</span>{' '}
                    <span className="font-mono text-[#0E4D3A] font-semibold">
                      {crop.nitrogenFixingKgHa > 0 ? `+${crop.nitrogenFixingKgHa} kg/ha` : 'None (0 kg/ha)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#5E6D64]">Rooting:</span>{' '}
                    <span className="font-mono text-[#132A20]">{crop.rootingDepthCm}</span>
                  </div>
                </div>

                <div className="text-xs text-[#44544B] space-y-1">
                  <div>
                    <span className="font-semibold text-[#132A20]">Soil & Seasons: </span>
                    {crop.soilPreference} ({crop.suitableSeasons})
                  </div>
                  <div>
                    <span className="font-semibold text-[#132A20]">Forage & Organic Matter: </span>
                    {crop.foragePotential} · OM contribution: {crop.organicMatterContrib}
                  </div>
                  <div>
                    <span className="font-semibold text-[#132A20]">Pest/Disease Notes: </span>
                    {crop.pestDiseaseNotes}
                  </div>
                  <div className="pt-1 text-[#0E4D3A]">
                    <span className="font-semibold">Good Predecessors: </span>
                    {crop.compatiblePredecessors.join(', ') || 'General'}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {filteredCrops.length === 0 && (
            <div className="bg-white border border-[#E2DDD1] rounded-xl p-8 text-center text-sm text-[#5E6D64]">
              <BookOpen className="w-6 h-6 mx-auto mb-2 text-[#8A621C]" />
              No crops matched your search filter.
            </div>
          )}
        </div>
      )}

      {/* Expert / Admin Crop Editor Modal */}
      {editingCrop && (
        <div className="fixed inset-0 z-50 bg-[#132A20]/50 flex items-center justify-center p-4">
          <form onSubmit={handleSaveCrop} className="bg-white border border-[#E2DDD1] rounded-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-display text-xl font-semibold text-[#132A20]">
              {editingCrop.id ? `Update Crop: ${editingCrop.name}` : 'Add New Crop to Intelligence Database'}
            </h3>
            {cropErr && <div className="p-2.5 text-xs bg-[#FDF2F0] border border-[#E5B8B0] text-[#8C2D19] rounded-lg">{cropErr}</div>}

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold mb-1">Crop Name *</label>
                <input
                  required
                  value={editingCrop.name ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, name: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Scientific Name *</label>
                <input
                  required
                  value={editingCrop.scientificName ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, scientificName: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Family *</label>
                <input
                  required
                  value={editingCrop.family ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, family: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Water Requirement (mm)</label>
                <input
                  value={editingCrop.waterReqMm ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, waterReqMm: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Growing Duration</label>
                <input
                  value={editingCrop.growingDurationDays ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, growingDurationDays: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold mb-1">Nitrogen Fixation (kg/ha)</label>
                <input
                  type="number"
                  value={editingCrop.nitrogenFixingKgHa ?? 0}
                  onChange={(e) => setEditingCrop({ ...editingCrop, nitrogenFixingKgHa: Number(e.target.value) })}
                  className="w-full px-3 py-2 font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">Soil Preference</label>
                <input
                  value={editingCrop.soilPreference ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, soilPreference: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-semibold mb-1">Pest & Disease Notes</label>
                <textarea
                  rows={2}
                  value={editingCrop.pestDiseaseNotes ?? ''}
                  onChange={(e) => setEditingCrop({ ...editingCrop, pestDiseaseNotes: e.target.value })}
                  className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingCrop(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-[#D8D2C3]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingCrop}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0E4D3A] text-white"
              >
                {savingCrop ? 'Saving...' : 'Save Crop Entry'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
