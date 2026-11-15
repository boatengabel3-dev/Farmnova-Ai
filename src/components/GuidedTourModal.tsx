import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, LayoutDashboard, Map, MessageSquare, Sprout, X } from 'lucide-react';

interface TourStep {
  title: string;
  subtitle: string;
  description: string;
  tabTarget?: 'dashboard' | 'environment' | 'map' | 'rotations' | 'assistant';
  icon: React.ReactNode;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Welcome to FarmNova AI',
    subtitle: 'Your satellite-guided farm planning workspace',
    description:
      'Your registered farm boundary, soil notes, and crop history are stored privately for your account. Use the Overview tab anytime to see farm health, hazard watches, and quick action links.',
    tabTarget: 'dashboard',
    icon: <LayoutDashboard className="w-5 h-5 text-[#0E4D3A]" />,
  },
  {
    title: 'Environment Page: Weather, Hazards & NASA Data',
    subtitle: 'Compare NASA POWER and live meteorological weather clearly',
    description:
      'Open the Environment page ("Weather, Hazards & NASA") to read plain-language 30-day rainfall totals, live 7-day forecasts, potential hazard alerts, 10-year monthly averages, and switch between NASA POWER, Meteomatics Weather API, or both side by side.',
    tabTarget: 'environment',
    icon: <Compass className="w-5 h-5 text-[#0E4D3A]" />,
  },
  {
    title: 'Geospatial Map & NASA GIBS Date Slider',
    subtitle: 'Inspect verified orbital satellite overlays',
    description:
      'Use the Geospatial Map tab to view your farm outline under NASA GIBS layers (NDVI vegetation, surface temperature, rainfall rate, and SMAP soil moisture) with a live date slider.',
    tabTarget: 'map',
    icon: <Map className="w-5 h-5 text-[#0E4D3A]" />,
  },
  {
    title: '3 Crop Rotation Strategies & Climate Scenarios',
    subtitle: 'Plan future planting seasons transparently',
    description:
      'Compare three crop sequences tailored to your priorities, soil notes, and water supply—then test drought or heat-stress scenarios before buying seed.',
    tabTarget: 'rotations',
    icon: <Sprout className="w-5 h-5 text-[#0E4D3A]" />,
  },
  {
    title: 'AI Agronomic Assistant & Field Reports',
    subtitle: 'Ask questions & download PDF/CSV briefings',
    description:
      'Ask practical agronomy questions grounded in your farm data, or export printable PDF and CSV reports to share with local extension officers.',
    tabTarget: 'assistant',
    icon: <MessageSquare className="w-5 h-5 text-[#0E4D3A]" />,
  },
];

interface Props {
  onClose: () => void;
  onJumpToTab?: (tab: 'dashboard' | 'environment' | 'map' | 'rotations' | 'assistant') => void;
}

export function GuidedTourModal({ onClose, onJumpToTab }: Props) {
  const [stepIdx, setStepIdx] = useState(0);
  const current = TOUR_STEPS[stepIdx];
  const isLast = stepIdx === TOUR_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 bg-[#132A20]/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-[#FAF8F3] border border-[#DFD9CB] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden">
        <div className="px-5 py-4 bg-white border-b border-[#E2DDD1] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#F1F7F4] border border-[#C6D8CE] flex items-center justify-center shrink-0">
              {current.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-[#8A621C]">
                Guided Tour · Step {stepIdx + 1} of {TOUR_STEPS.length}
              </div>
              <h3 className="font-display text-base sm:text-lg font-semibold text-[#132A20] truncate">
                {current.title}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guided tour"
            className="p-1.5 rounded-lg text-[#5E6D64] hover:text-[#132A20] hover:bg-[#F2EFE7] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-xs font-semibold text-[#0E4D3A]">{current.subtitle}</div>
          <p className="text-sm text-[#2E3E35] leading-relaxed">{current.description}</p>

          {current.tabTarget && onJumpToTab && (
            <button
              type="button"
              onClick={() => {
                onJumpToTab(current.tabTarget!);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#0E4D3A] text-xs font-semibold text-[#0E4D3A] hover:bg-[#0E4D3A]/5"
            >
              Go to this page now →
            </button>
          )}

          {/* Step Dots */}
          <div className="flex items-center gap-1.5 pt-2">
            {TOUR_STEPS.map((s, idx) => (
              <button
                key={s.title}
                type="button"
                aria-label={`Tour step ${idx + 1}`}
                onClick={() => setStepIdx(idx)}
                className={`h-1.5 rounded-full transition-all ${
                  idx === stepIdx ? 'w-6 bg-[#0E4D3A]' : 'w-2 bg-[#D8D2C3]'
                }`}
              />
            ))}
          </div>
        </div>

        <div className="px-5 py-3.5 bg-white border-t border-[#E2DDD1] flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#D8D2C3] text-xs font-medium text-[#2E3E35] hover:bg-[#F2EFE7] disabled:opacity-40"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-[#5E6D64] hover:text-[#132A20]"
            >
              Skip Tour
            </button>
            {isLast ? (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0E4D3A] text-[#FAF8F3] text-xs font-semibold hover:bg-[#0A3A2B]"
              >
                <Check className="w-3.5 h-3.5" /> Finish
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStepIdx((i) => Math.min(TOUR_STEPS.length - 1, i + 1))}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#0E4D3A] text-[#FAF8F3] text-xs font-semibold hover:bg-[#0A3A2B]"
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
