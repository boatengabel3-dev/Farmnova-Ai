import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CloudRain,
  Compass,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Sliders,
  Sprout,
  ThermometerSun,
  X,
} from 'lucide-react';
import { BrandMark } from './components/BrandMark';
import { LandingAuthView } from './components/LandingAuthView';
import { FarmOnboardingModal } from './components/FarmOnboardingModal';
import { FarmMapPanel } from './components/FarmMapPanel';
import { EnvironmentalModule } from './components/EnvironmentalModule';
import { RotationStrategyView } from './components/RotationStrategyView';
import { ScenarioExplorer } from './components/ScenarioExplorer';
import { AiAssistantPanel } from './components/AiAssistantPanel';
import { AccountSettingsPanel, AdminDashboardPanel } from './components/AccountAndAdminPanels';
import { api, downloadFarmCsv, generateFarmPdfReport, getStoredToken, setStoredToken } from './lib/api';
import type { Announcement, Crop, EnvironmentalAnalysis, Farm, RotationStrategy, User } from './types';

type WorkspaceTab =
  | 'dashboard'
  | 'environment'
  | 'map'
  | 'rotations'
  | 'scenarios'
  | 'assistant'
  | 'reports'
  | 'account'
  | 'admin';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [farms, setFarms] = useState<Farm[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EnvironmentalAnalysis | null>(null);
  const [strategies, setStrategies] = useState<RotationStrategy[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<WorkspaceTab>('dashboard');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [editingFarm, setEditingFarm] = useState<Farm | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Check existing session on load
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setAuthChecking(false);
      return;
    }
    api
      .me()
      .then((res) => setUser(res.user))
      .catch(() => setStoredToken(null))
      .finally(() => setAuthChecking(false));
  }, []);

  // Load user's farms, crops, and announcements once authenticated
  async function loadWorkspaceData(currentUser: User) {
    const [farmsRes, cropsRes, annRes] = await Promise.all([api.listFarms(), api.listCrops(), api.announcements()]);
    setFarms(farmsRes.farms);
    setCrops(cropsRes.crops);
    setAnnouncements(annRes.announcements);

    if (farmsRes.farms.length > 0) {
      setSelectedFarmId((prev) => (prev && farmsRes.farms.some((f) => f.id === prev) ? prev : farmsRes.farms[0].id));
    } else {
      setSelectedFarmId(null);
      setAnalysis(null);
      setStrategies([]);
      if (currentUser.role !== 'admin') {
        setShowOnboarding(true);
      }
    }
  }

  useEffect(() => {
    if (user) {
      loadWorkspaceData(user);
    }
  }, [user?.id]);

  // Fetch NASA environmental analysis & rotation strategies for selected farm
  async function loadFarmAnalysis(farmId: string, forceRefresh = false) {
    setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const res = await api.getFarmAnalysis(farmId, forceRefresh);
      setAnalysis(res.analysis);
      setStrategies(res.strategies);
    } catch (err: any) {
      setAnalysisError(err.message);
    } finally {
      setLoadingAnalysis(false);
    }
  }

  useEffect(() => {
    if (selectedFarmId && user) {
      loadFarmAnalysis(selectedFarmId, false);
    }
  }, [selectedFarmId]);

  async function handleSaveFarm(payload: Partial<Farm>, existingId?: string) {
    let saved: Farm;
    if (existingId) {
      const res = await api.updateFarm(existingId, payload);
      saved = res.farm;
    } else {
      const res = await api.createFarm(payload);
      saved = res.farm;
    }
    const listRes = await api.listFarms();
    setFarms(listRes.farms);
    setSelectedFarmId(saved.id);
    setShowOnboarding(false);
    setEditingFarm(null);
    await loadFarmAnalysis(saved.id, true);
  }

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setStoredToken(null);
    setUser(null);
    setFarms([]);
    setAnalysis(null);
    setStrategies([]);
  }

  if (authChecking) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] flex items-center justify-center text-sm text-[#47564E]">
        Verifying session...
      </div>
    );
  }

  if (!user) {
    return (
      <LandingAuthView
        onAuthenticated={(authedUser) => {
          setUser(authedUser);
          setActiveTab(authedUser.role === 'admin' ? 'admin' : 'dashboard');
        }}
      />
    );
  }

  const selectedFarm = farms.find((f) => f.id === selectedFarmId) ?? null;

  const navItems: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode; adminOnly?: boolean; needsFarm?: boolean }> = [
    { id: 'dashboard', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" />, needsFarm: true },
    { id: 'environment', label: 'NASA Observations', icon: <Compass className="w-4 h-4" />, needsFarm: true },
    { id: 'map', label: 'Geospatial Map', icon: <MapIcon className="w-4 h-4" />, needsFarm: true },
    { id: 'rotations', label: 'Rotation & Crops', icon: <Sprout className="w-4 h-4" />, needsFarm: true },
    { id: 'scenarios', label: 'Climate Scenarios', icon: <Sliders className="w-4 h-4" />, needsFarm: true },
    { id: 'assistant', label: 'AI Assistant', icon: <MessageSquare className="w-4 h-4" />, needsFarm: true },
    { id: 'reports', label: 'Reports & Export', icon: <FileText className="w-4 h-4" />, needsFarm: true },
    { id: 'account', label: 'Account Settings', icon: <Settings className="w-4 h-4" /> },
    ...(user.role === 'admin' ? [{ id: 'admin' as const, label: 'Admin Console', icon: <Shield className="w-4 h-4" />, adminOnly: true }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F3] text-[#132A20] flex">
      {/* Desktop Sidebar (256px) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col bg-[#132A20] text-[#FAF8F3] border-r border-[#1F3F31] sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <BrandMark className="w-8 h-8 shrink-0" />
          <div>
            <div className="font-display text-lg font-semibold leading-none">TerraVane</div>
            <div className="text-[11px] text-[#C8D4CD] mt-1 capitalize">{user.role} workspace</div>
          </div>
        </div>

        {/* Farm Switcher */}
        <div className="px-4 py-4 border-b border-white/10 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-[#B5C4BC]">
            <span>Active Farm Plot</span>
            <button
              type="button"
              onClick={() => {
                setEditingFarm(null);
                setShowOnboarding(true);
              }}
              className="inline-flex items-center gap-1 text-[#E4C37A] hover:underline font-medium"
            >
              <Plus className="w-3 h-3" /> Add Farm
            </button>
          </div>
          {farms.length > 0 ? (
            <select
              value={selectedFarmId ?? ''}
              onChange={(e) => setSelectedFarmId(e.target.value)}
              className="w-full px-2.5 py-2 text-xs bg-[#1C3B2D] border border-white/15 rounded-lg text-[#FAF8F3] focus:outline-none focus:border-[#E4C37A]"
            >
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.sizeHectares} ha)
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={() => setShowOnboarding(true)}
              className="w-full py-2 px-3 rounded-lg bg-[#0E4D3A] border border-[#E4C37A]/50 text-xs font-semibold text-[#FAF8F3] text-left"
            >
              + Register Your First Farm
            </button>
          )}
        </div>

        {/* Nav Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const disabled = item.needsFarm && !selectedFarm;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#0E4D3A] text-[#FAF8F3] border border-[#E4C37A]/40'
                    : disabled
                    ? 'text-white/30 cursor-not-allowed'
                    : 'text-[#C8D4CD] hover:bg-white/5 hover:text-white'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-2">
          <div className="text-xs truncate font-medium text-[#FAF8F3]">{user.name}</div>
          <div className="text-[11px] truncate text-[#B5C4BC]">{user.email}</div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium text-[#FAF8F3] transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Context Header */}
        <header className="bg-white border-b border-[#E2DDD1] px-6 py-3.5 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="lg:hidden p-2 rounded-lg border border-[#D8D2C3]"
              aria-label="Toggle navigation"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <div className="text-xs text-[#5E6D64] truncate">
              <span>TerraVane</span>
              <span className="mx-2">/</span>
              <span className="font-semibold text-[#132A20]">
                {selectedFarm ? `${selectedFarm.name} · ${selectedFarm.region}, ${selectedFarm.country}` : 'Workspace'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {selectedFarm && (
              <button
                type="button"
                onClick={() => {
                  setEditingFarm(selectedFarm);
                  setShowOnboarding(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[#D8D2C3] hover:border-[#0E4D3A] whitespace-nowrap"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit Farm
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setEditingFarm(null);
                setShowOnboarding(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-[#0E4D3A] text-[#FAF8F3] hover:bg-[#0A3A2B] whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" /> New Farm
            </button>
          </div>
        </header>

        {/* Mobile Drawer Nav */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-[#132A20] text-[#FAF8F3] p-4 space-y-2 border-b border-[#1F3F31]">
            {farms.length > 0 && (
              <select
                value={selectedFarmId ?? ''}
                onChange={(e) => setSelectedFarmId(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#1C3B2D] border border-white/15 rounded-lg"
              >
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={item.needsFarm && !selectedFarm}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                    activeTab === item.id ? 'bg-[#0E4D3A]' : 'bg-white/5'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full py-2 text-xs font-semibold bg-white/10 rounded-lg"
            >
              Sign Out
            </button>
          </div>
        )}

        {/* Active Platform Announcements */}
        {announcements.length > 0 && (
          <div className="bg-[#F2EFE7] border-b border-[#E2DDD1] px-6 py-2.5 text-xs text-[#2E3E35] flex items-center justify-between gap-4">
            <div>
              <span className="font-semibold text-[#0E4D3A]">{announcements[0].title}: </span>
              <span>{announcements[0].body}</span>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
          {analysisError && (
            <div className="p-4 rounded-xl bg-[#FDF2F0] border border-[#E5B8B0] text-xs text-[#8C2D19]">
              {analysisError}
            </div>
          )}

          {activeTab === 'account' && (
            <AccountSettingsPanel user={user} onUserUpdated={(u) => setUser(u)} />
          )}

          {activeTab === 'admin' && user.role === 'admin' && (
            <AdminDashboardPanel
              onAnnouncementsChanged={async () => {
                const res = await api.announcements();
                setAnnouncements(res.announcements);
              }}
            />
          )}

          {!selectedFarm && activeTab !== 'account' && activeTab !== 'admin' && (
            <div className="bg-white border border-[#E2DDD1] rounded-xl p-10 text-center space-y-4">
              <Sprout className="w-10 h-10 text-[#0E4D3A] mx-auto" />
              <h2 className="font-display text-2xl font-semibold text-[#132A20]">No Farm Registered Yet</h2>
              <p className="text-sm text-[#47564E] max-w-lg mx-auto">
                Register your farm boundary, soil observations, and crop history to retrieve live NASA climate data and tailored crop-rotation strategies.
              </p>
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="px-5 py-2.5 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B]"
              >
                Start Guided Farm Registration
              </button>
            </div>
          )}

          {selectedFarm && loadingAnalysis && !analysis && activeTab !== 'account' && activeTab !== 'admin' && (
            <div className="bg-white border border-[#E2DDD1] rounded-xl p-10 text-center space-y-2">
              <div className="text-sm font-semibold text-[#132A20]">
                Retrieving live NASA POWER meteorology, GPM rainfall, SMAP wetness, and SRTM terrain data...
              </div>
              <p className="text-xs text-[#5E6D64]">
                Harmonizing observations for {selectedFarm.centroidLat.toFixed(4)}°, {selectedFarm.centroidLon.toFixed(4)}°
              </p>
            </div>
          )}

          {selectedFarm && analysis && activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Farm Header & Environmental Overview KPI Strip */}
              <div className="bg-white border border-[#E2DDD1] rounded-xl p-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-[#ECE8DD]">
                  <div>
                    <div className="text-xs text-[#8A621C] font-semibold">
                      {selectedFarm.farmingType} · {selectedFarm.sizeHectares} ha
                    </div>
                    <h1 className="font-display text-2xl sm:text-3xl font-semibold text-[#132A20] mt-0.5">
                      {selectedFarm.name}
                    </h1>
                    <p className="text-xs text-[#5E6D64] mt-1">
                      {selectedFarm.district}, {selectedFarm.region}, {selectedFarm.country} · Observation window:{' '}
                      <span className="font-mono">{analysis.periodSummary.startDate} to {analysis.periodSummary.endDate}</span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('rotations')}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0E4D3A] text-[#FAF8F3] hover:bg-[#0A3A2B]"
                    >
                      Compare 3 Rotation Strategies
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('assistant')}
                      className="px-4 py-2 text-xs font-semibold rounded-lg border border-[#D8D2C3] hover:border-[#0E4D3A]"
                    >
                      Ask AI Assistant
                    </button>
                  </div>
                </div>

                {/* 4-Column Tabular Metrics Strip */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pt-5">
                  <div>
                    <div className="text-xs text-[#5E6D64] flex items-center gap-1.5">
                      <CloudRain className="w-3.5 h-3.5 text-[#0E4D3A]" /> 12-Month Rainfall
                    </div>
                    <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">
                      {analysis.periodSummary.totalRainMm ?? 'N/A'}{' '}
                      <span className="text-xs font-normal text-[#5E6D64]">mm</span>
                    </div>
                    <div className="text-[11px] text-[#47564E] mt-0.5">
                      Longest dry spell: {analysis.periodSummary.longestDrySpellDays} days
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[#5E6D64] flex items-center gap-1.5">
                      <ThermometerSun className="w-3.5 h-3.5 text-[#B8862D]" /> Mean Temperature
                    </div>
                    <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">
                      {analysis.periodSummary.avgTempC ?? 'N/A'}{' '}
                      <span className="text-xs font-normal text-[#5E6D64]">°C</span>
                    </div>
                    <div className="text-[11px] text-[#47564E] mt-0.5">
                      {analysis.periodSummary.heatStressDaysAbove35C} days ≥35 °C (max {analysis.periodSummary.maxTempObservedC ?? '—'}°C)
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[#5E6D64]">Root-Zone Wetness (0–100 cm)</div>
                    <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">
                      {analysis.periodSummary.avgRootSoilWetness !== null
                        ? `${(analysis.periodSummary.avgRootSoilWetness * 100).toFixed(1)}%`
                        : 'N/A'}
                    </div>
                    <div className="text-[11px] text-[#47564E] mt-0.5">
                      90d anomaly:{' '}
                      {analysis.periodSummary.soilMoistureAnomalyPct !== null
                        ? `${analysis.periodSummary.soilMoistureAnomalyPct >= 0 ? '+' : ''}${analysis.periodSummary.soilMoistureAnomalyPct}% vs 5-yr norm`
                        : 'N/A'}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs text-[#5E6D64]">SRTM Elevation & Slope</div>
                    <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">
                      {analysis.elevationMeters ?? 'N/A'}{' '}
                      <span className="text-xs font-normal text-[#5E6D64]">m</span>
                    </div>
                    <div className="text-[11px] text-[#47564E] mt-0.5">
                      Estimated slope: {analysis.terrainSlopePct !== null ? `${analysis.terrainSlopePct}%` : 'Unavailable'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Map Preview + Soil & Rotation Snapshot */}
              <div className="grid lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-6">
                  <FarmMapPanel farm={selectedFarm} analysis={analysis} compact />
                </div>

                <div className="lg:col-span-6 bg-white border border-[#E2DDD1] rounded-xl p-5 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-lg font-semibold text-[#132A20]">Soil & Crop Rotation Overview</h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('map')}
                        className="text-xs font-semibold text-[#0E4D3A] hover:underline"
                      >
                        Open Satellite Layers →
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs bg-[#FAF8F3] border border-[#ECE8DD] rounded-lg p-3.5">
                      <div>
                        <span className="text-[#5E6D64]">Soil Profile:</span>{' '}
                        <span className="font-medium text-[#132A20]">{selectedFarm.soilType} ({selectedFarm.soilTexture})</span>
                      </div>
                      <div>
                        <span className="text-[#5E6D64]">Soil pH / OM:</span>{' '}
                        <span className="font-mono text-[#132A20]">
                          {selectedFarm.soilPh ?? 'Unknown'} / {selectedFarm.organicMatterPct !== null ? `${selectedFarm.organicMatterPct}%` : 'Unknown'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#5E6D64]">Current Crops:</span>{' '}
                        <span className="font-medium text-[#132A20]">{selectedFarm.currentCrops.join(', ') || 'None'}</span>
                      </div>
                      <div>
                        <span className="text-[#5E6D64]">Irrigation:</span>{' '}
                        <span className="font-medium text-[#132A20]">{selectedFarm.irrigationAvailable}</span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-[#132A20]">Generated Rotation Paths</div>
                      {strategies.map((s) => (
                        <div key={s.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#F0ECE2] last:border-0 text-xs">
                          <div>
                            <span className="font-semibold text-[#0E4D3A]">{s.label}: {s.title}</span>
                            <div className="text-[#5E6D64]">{s.subtitle}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab('rotations')}
                            className="text-xs font-medium text-[#0E4D3A] hover:underline shrink-0"
                          >
                            Compare
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Important Agricultural Insights & Areas for Further Investigation */}
              <div className="grid lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-semibold text-[#132A20]">Important Agricultural Insights</h2>
                    <button
                      type="button"
                      onClick={() => setActiveTab('environment')}
                      className="text-xs font-semibold text-[#0E4D3A] hover:underline"
                    >
                      Full NASA Charts & Provenance →
                    </button>
                  </div>
                  <div className="space-y-3">
                    {analysis.insights.slice(0, 4).map((ins) => (
                      <div key={ins.id} className="p-3.5 rounded-lg bg-[#FAF8F3] border border-[#ECE8DD] text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[#132A20]">{ins.title}</span>
                          <span className="text-[11px] font-medium text-[#5E6D64]">{ins.observationType}</span>
                        </div>
                        <p className="text-[#3B4A42] leading-relaxed">{ins.whatWasObserved}</p>
                        <p className="text-[#0E4D3A]">{ins.whatItCouldMean}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="lg:col-span-5 bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-[#B8862D]" />
                    <h2 className="font-display text-lg font-semibold text-[#132A20]">Recommended Areas for Investigation</h2>
                  </div>
                  <p className="text-xs text-[#5E6D64]">
                    Local field checks and soil tests needed to complement coarse satellite observations:
                  </p>
                  <ul className="space-y-2.5 text-xs text-[#2E3E35]">
                    {analysis.areasForInvestigation.map((item) => (
                      <li key={item} className="p-3 rounded-lg bg-[#FDF8EE] border border-[#E8D5A7] leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('reports')}
                      className="w-full py-2.5 px-4 rounded-lg border border-[#0E4D3A] text-[#0E4D3A] text-xs font-semibold hover:bg-[#0E4D3A]/5"
                    >
                      Prepare Extension Briefing (PDF / CSV)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedFarm && analysis && activeTab === 'environment' && (
            <EnvironmentalModule
              analysis={analysis}
              refreshing={loadingAnalysis}
              onRefresh={() => loadFarmAnalysis(selectedFarm.id, true)}
            />
          )}

          {selectedFarm && analysis && activeTab === 'map' && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#132A20]">Interactive Geospatial Satellite Map</h2>
                <p className="text-sm text-[#47564E] mt-1">
                  Inspect your registered farm polygon alongside live NASA GIBS orbital overlays (MODIS NDVI, MODIS Surface Temp, GPM Rainfall, SMAP Soil Moisture).
                </p>
              </div>
              <FarmMapPanel farm={selectedFarm} analysis={analysis} />
            </div>
          )}

          {selectedFarm && analysis && activeTab === 'rotations' && (
            <RotationStrategyView
              strategies={strategies}
              crops={crops}
              user={user}
              onCropsChanged={async () => {
                const res = await api.listCrops();
                setCrops(res.crops);
                await loadFarmAnalysis(selectedFarm.id, false);
              }}
            />
          )}

          {selectedFarm && activeTab === 'scenarios' && <ScenarioExplorer farm={selectedFarm} />}

          {selectedFarm && activeTab === 'assistant' && <AiAssistantPanel farm={selectedFarm} />}

          {selectedFarm && analysis && activeTab === 'reports' && (
            <div className="max-w-4xl space-y-6">
              <div>
                <h2 className="font-display text-2xl font-semibold text-[#132A20]">Farm Intelligence Reports & Exports</h2>
                <p className="text-sm text-[#47564E] mt-1">
                  Download structured agricultural briefings containing farm boundaries, NASA data provenance, 3 rotation strategies, and scientific limitations for review with local extension officers.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-5">
                <div className="bg-white border border-[#E2DDD1] rounded-xl p-6 space-y-4">
                  <FileText className="w-7 h-7 text-[#0E4D3A]" />
                  <div>
                    <h3 className="font-display text-lg font-semibold text-[#132A20]">Agronomic & NASA Briefing (PDF)</h3>
                    <p className="text-xs text-[#47564E] mt-1 leading-relaxed">
                      Multi-section printable report summarizing registered soil profile, NASA rainfall/temperature/moisture trends, 3 crop rotation strategies, risks, and local verification checklist.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => generateFarmPdfReport(selectedFarm, analysis, strategies)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0E4D3A] text-[#FAF8F3] text-xs font-semibold rounded-lg hover:bg-[#0A3A2B]"
                  >
                    <Download className="w-4 h-4" /> Download PDF Report
                  </button>
                </div>

                <div className="bg-white border border-[#E2DDD1] rounded-xl p-6 space-y-4">
                  <FileSpreadsheet className="w-7 h-7 text-[#B8862D]" />
                  <div>
                    <h3 className="font-display text-lg font-semibold text-[#132A20]">Full Telemetry & Rotation Dataset (CSV)</h3>
                    <p className="text-xs text-[#47564E] mt-1 leading-relaxed">
                      Spreadsheet-ready export with 365 days of NASA POWER daily temperature, rainfall, soil wetness, derived ET0, and strategy comparison rows.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadFarmCsv(selectedFarm)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 border border-[#0E4D3A] text-[#0E4D3A] text-xs font-semibold rounded-lg hover:bg-[#0E4D3A]/5"
                  >
                    <Download className="w-4 h-4" /> Download CSV Data
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Multi-Step Guided Farm Onboarding / Editor Modal */}
      {showOnboarding && (
        <FarmOnboardingModal
          initialFarm={editingFarm}
          crops={crops}
          isFirstOnboarding={farms.length === 0}
          onSave={handleSaveFarm}
          onClose={farms.length > 0 || user.role === 'admin' ? () => { setShowOnboarding(false); setEditingFarm(null); } : undefined}
        />
      )}
    </div>
  );
}
