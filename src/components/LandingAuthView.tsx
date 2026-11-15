import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Compass, Layers, ShieldCheck, Sprout } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { api, setStoredToken } from '../lib/api';
import { LanguageSelector, useI18n } from '../lib/i18n';
import type { User } from '../types';

interface Props {
  onAuthenticated: (user: User, pendingVerifyToken?: string) => void;
}

type AuthMode = 'login' | 'register' | 'forgot' | 'verify';

export function LandingAuthView({ onAuthenticated }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [region, setRegion] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [issuedInfo, setIssuedInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(email, password);
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function quickDemoLogin(demoEmail: string, demoPass: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await api.login(demoEmail, demoPass);
      setStoredToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.register({ email, password, name, role: 'farmer', organization, region });
      setStoredToken(res.token);
      setVerifyCode(res.verificationToken);
      setIssuedInfo(`Account created. Your verification code is ${res.verificationToken} — verify now or continue to farm registration.`);
      setMode('verify');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.verifyEmail(email, verifyCode);
      if (res.user) {
        onAuthenticated(res.user);
      } else {
        const me = await api.me();
        onAuthenticated(me.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.forgotPassword(email);
      if (res.demoRecoveryToken) {
        setResetToken(res.demoRecoveryToken);
        setIssuedInfo(`Recovery token issued: ${res.demoRecoveryToken}`);
      } else {
        setIssuedInfo(res.message);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.resetPassword(email, resetToken, newPassword);
      setIssuedInfo(res.message);
      setMode('login');
      setPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F3] text-[#132A20]">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="border-b border-[#E2DDD1] bg-[#FAF8F3]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-2 sm:gap-8">
          <a href="#top" className="flex items-center gap-2 sm:gap-3 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#0E4D3A] rounded-md">
            <BrandMark className="w-8 h-8 sm:w-9 sm:h-9" />
            <span className="font-display text-lg sm:text-xl font-semibold tracking-tight text-[#132A20]">FarmNova AI</span>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#47564E]">
            <a href="#science" className="hover:text-[#0E4D3A] transition-colors whitespace-nowrap shrink-0">
              {t('nav.earth')}
            </a>
            <a href="#rotations" className="hover:text-[#0E4D3A] transition-colors whitespace-nowrap shrink-0">
              {t('nav.rotations')}
            </a>
            <a href="#transparency" className="hover:text-[#0E4D3A] transition-colors whitespace-nowrap shrink-0">
              {t('nav.rigor')}
            </a>
            <a href="#access" className="hover:text-[#0E4D3A] transition-colors whitespace-nowrap shrink-0">
              {t('nav.access')}
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <LanguageSelector />
            <a
              href="#access"
              onClick={() => setMode('register')}
              className="px-2.5 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-semibold text-[#FAF8F3] bg-[#0E4D3A] rounded-lg hover:bg-[#0A3A2B] transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 sm:gap-2"
            >
              <span className="hidden xs:inline sm:inline">{t('nav.registerFarm')}</span>
              <span className="xs:hidden sm:hidden">Register</span>
              <ArrowRight className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* Hero Split Section */}
      <section id="top" className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-12 pb-12 sm:pb-16">
        <div className="grid lg:grid-cols-12 gap-10 items-stretch">
          {/* Left Editorial Column */}
          <div className="lg:col-span-7 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium tracking-wide text-[#8A621C] mb-4">
                {t('hero.tag')}
              </p>
              <h1 className="font-display text-3xl sm:text-5xl font-semibold tracking-tight text-[#132A20] leading-[1.12] [text-wrap:balance] max-w-2xl">
                {t('hero.title')}
              </h1>
              <p className="mt-5 text-base sm:text-lg text-[#44544B] leading-relaxed max-w-2xl">
                {t('hero.subtitle')}
              </p>

              {/* Editorial Hero Photography Frame */}
              <div className="mt-8 relative rounded-xl overflow-hidden border border-[#DFD9CB] bg-[#EAE4D7] aspect-[16/9]">
                <img
                  src="/src/assets/images/hero_farmland_aerial_1794715062487.jpg"
                  alt="Aerial view of terraced maize and legume crop rotation strips across sunlit East African farmland"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0D2118]/80 via-[#0D2118]/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-6 text-[#FAF8F3]">
                  <p className="text-xs text-[#E4C37A] font-medium mb-1">
                    Harmonized Multi-Mission Architecture · POWER · GPM · SMAP · MODIS · SRTM
                  </p>
                  <p className="text-sm sm:text-base font-medium max-w-xl">
                    Built to support farmer judgment and extension expertise—clearly separating orbital observations from field-level realities.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Auth & Quick Access Console */}
          <div id="access" className="lg:col-span-5 flex flex-col">
            <div className="bg-white border border-[#E2DDD1] rounded-xl p-6 sm:p-8 flex-1 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-[#ECE8DD] pb-4 mb-6">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-[#132A20]">
                      {mode === 'login' && t('auth.signInTitle')}
                      {mode === 'register' && t('auth.registerTitle')}
                      {mode === 'verify' && 'Verify your email'}
                      {mode === 'forgot' && 'Password recovery'}
                    </h2>
                    <p className="text-xs text-[#5E6D64] mt-1">
                      {mode === 'register'
                        ? 'Registration is exclusively for farmers. Private farm boundaries stay strictly isolated per account.'
                        : 'Private farm boundaries and agronomic records stay strictly isolated per account.'}
                    </p>
                  </div>
                </div>

                {/* Segmented Auth Mode Switch */}
                <div className="flex items-center gap-1 p-1 bg-[#F2EFE7] rounded-lg mb-5">
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(null); setIssuedInfo(null); }}
                    className={`flex-1 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      mode === 'login' ? 'bg-white text-[#132A20] shadow-sm' : 'text-[#5A665E] hover:text-[#132A20]'
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('register'); setError(null); setIssuedInfo(null); }}
                    className={`flex-1 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      mode === 'register' ? 'bg-white text-[#132A20] shadow-sm' : 'text-[#5A665E] hover:text-[#132A20]'
                    }`}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(null); setIssuedInfo(null); }}
                    className={`flex-1 py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                      mode === 'forgot' ? 'bg-white text-[#132A20] shadow-sm' : 'text-[#5A665E] hover:text-[#132A20]'
                    }`}
                  >
                    Recover
                  </button>
                </div>

                {error && (
                  <div className="mb-4 p-3 rounded-lg bg-[#FDF2F0] border border-[#E5B8B0] text-xs text-[#8C2D19]">
                    {error}
                  </div>
                )}
                {issuedInfo && (
                  <div className="mb-4 p-3 rounded-lg bg-[#F1F7F4] border border-[#B8D8C8] text-xs text-[#0E4D3A]">
                    {issuedInfo}
                  </div>
                )}

                {mode === 'login' && (
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">Email Address</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="farmer@example.org"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">Password</label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 px-4 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B] transition-colors disabled:opacity-60"
                    >
                      {loading ? 'Signing in...' : 'Sign In to Dashboard'}
                    </button>
                  </form>
                )}

                {mode === 'register' && (
                  <form onSubmit={handleRegister} className="space-y-3.5">
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Full Name (Farmer Account)</label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Abigail Boateng"
                        className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Email Address</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="abigail@cooperative.org"
                        className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Region / Country</label>
                        <input
                          type="text"
                          value={region}
                          onChange={(e) => setRegion(e.target.value)}
                          placeholder="e.g. Iowa, USA · Punjab, India · Ashanti, Ghana"
                          className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Cooperative / Org</label>
                        <input
                          type="text"
                          value={organization}
                          onChange={(e) => setOrganization(e.target.value)}
                          placeholder="Optional"
                          className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Password (min 8 chars)</label>
                      <input
                        type="password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Create strong password"
                        className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                      />
                    </div>
                    <div className="flex gap-2.5 pt-1">
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 py-2.5 px-4 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B] transition-colors disabled:opacity-60"
                      >
                        {loading ? 'Creating Account...' : 'Create Farmer Account'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('login');
                          setError(null);
                          setIssuedInfo(null);
                        }}
                        className="py-2.5 px-4 border border-[#D8D2C3] text-sm font-medium text-[#2E3E35] rounded-lg hover:bg-[#F2EFE7] transition-colors"
                      >
                        Exit
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'verify' && (
                  <form onSubmit={handleVerifyEmail} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-[#2E3E35] mb-1.5">Verification Code</label>
                      <input
                        type="text"
                        required
                        value={verifyCode}
                        onChange={(e) => setVerifyCode(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg focus:outline-none focus:border-[#0E4D3A]"
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 py-2.5 px-4 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B]"
                      >
                        Verify Email
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const me = await api.me();
                          onAuthenticated(me.user);
                        }}
                        className="py-2.5 px-4 border border-[#D8D2C3] text-sm font-medium rounded-lg hover:bg-[#F2EFE7]"
                      >
                        Skip for Now
                      </button>
                    </div>
                  </form>
                )}

                {mode === 'forgot' && (
                  <div className="space-y-4">
                    <form onSubmit={handleForgot} className="space-y-3">
                      <div>
                        <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Registered Email</label>
                        <input
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="kwame.mensah@farmnova.ai"
                          className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2 px-4 border border-[#0E4D3A] text-[#0E4D3A] text-xs font-semibold rounded-lg hover:bg-[#0E4D3A]/5"
                      >
                        Request Recovery Token
                      </button>
                    </form>
                    {resetToken && (
                      <form onSubmit={handleReset} className="space-y-3 pt-3 border-t border-[#ECE8DD]">
                        <div>
                          <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Recovery Token</label>
                          <input
                            type="text"
                            required
                            value={resetToken}
                            onChange={(e) => setResetToken(e.target.value)}
                            className="w-full px-3 py-2 text-sm font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-[#2E3E35] mb-1">New Password</label>
                          <input
                            type="password"
                            required
                            minLength={8}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={loading}
                          className="w-full py-2.5 px-4 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B]"
                        >
                          Reset Password
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>

              {/* Instant Role Demonstration Access */}
              <div className="mt-6 pt-5 border-t border-[#ECE8DD]">
                <p className="text-xs font-semibold text-[#5A665E] mb-2.5">
                  Instant Role Demonstration Accounts
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => quickDemoLogin('kwame.mensah@farmnova.ai', 'FarmerTerra2026!')}
                    className="text-left px-3 py-2 rounded-lg border border-[#E2DDD1] bg-[#FAF8F3] hover:border-[#0E4D3A] transition-colors"
                  >
                    <div className="text-xs font-semibold text-[#132A20]">Farmer Demo</div>
                    <div className="text-[11px] text-[#5E6D64] truncate">Sample farms · Live weather & NASA</div>
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => quickDemoLogin('amina.osei@farmnova.ai', 'ExpertTerra2026!')}
                    className="text-left px-3 py-2 rounded-lg border border-[#E2DDD1] bg-[#FAF8F3] hover:border-[#0E4D3A] transition-colors"
                  >
                    <div className="text-xs font-semibold text-[#132A20]">Agri Expert</div>
                    <div className="text-[11px] text-[#5E6D64] truncate">Crop DB & field curation</div>
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => quickDemoLogin('david.kamau@farmnova.ai', 'ResearchTerra2026!')}
                    className="text-left px-3 py-2 rounded-lg border border-[#E2DDD1] bg-[#FAF8F3] hover:border-[#0E4D3A] transition-colors"
                  >
                    <div className="text-xs font-semibold text-[#132A20]">Researcher</div>
                    <div className="text-[11px] text-[#5E6D64] truncate">Climate & scenario tools</div>
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => quickDemoLogin('admin@farmnova.ai', 'AdminTerra2026!')}
                    className="text-left px-3 py-2 rounded-lg border border-[#E2DDD1] bg-[#FAF8F3] hover:border-[#0E4D3A] transition-colors"
                  >
                    <div className="text-xs font-semibold text-[#132A20]">Administrator</div>
                    <div className="text-[11px] text-[#5E6D64] truncate">Governance & audit logs</div>
                  </button>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => quickDemoLogin('kwame.mensah@farmnova.ai', 'FarmerTerra2026!')}
                  className="mt-2.5 w-full py-2 px-3 rounded-lg border border-[#0E4D3A]/30 bg-white hover:border-[#0E4D3A] text-xs font-semibold text-[#0E4D3A] transition-colors"
                >
                  {t('auth.guestBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Scientific Pillar Grid */}
      <section id="science" className="border-t border-[#E2DDD1] bg-[#F2EFE7]/65 py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <Compass className="w-6 h-6 text-[#0E4D3A] mb-3" />
              <h3 className="font-display text-xl font-semibold text-[#132A20]">Live NASA Earth Observations</h3>
              <p className="mt-2 text-sm text-[#47564E] leading-relaxed">
                Queries live NASA POWER meteorology, GPM precipitation heritage, SMAP root-zone soil wetness, SRTM terrain slope, and MODIS/GIBS orbital map layers for your exact boundary coordinates.
              </p>
            </div>
            <div id="rotations">
              <Sprout className="w-6 h-6 text-[#0E4D3A] mb-3" />
              <h3 className="font-display text-xl font-semibold text-[#132A20]">Three Transparent Rotation Paths</h3>
              <p className="mt-2 text-sm text-[#47564E] leading-relaxed">
                Compares your current cropping baseline against a Soil & Moisture Resilience sequence and a Market-Balanced Diversified rotation across 8 agronomic indicators—never inventing black-box scores.
              </p>
            </div>
            <div id="transparency">
              <ShieldCheck className="w-6 h-6 text-[#0E4D3A] mb-3" />
              <h3 className="font-display text-xl font-semibold text-[#132A20]">Honest About Limitations</h3>
              <p className="mt-2 text-sm text-[#47564E] leading-relaxed">
                Every chart and AI explanation separates direct satellite measurements from derived indicators, marks missing soil tests, and warns against misreading coarse-resolution basin data as plot moisture.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Visual Stewardship Band */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-12 gap-8 items-center">
          <div className="md:col-span-5 rounded-xl overflow-hidden border border-[#DFD9CB] aspect-[4/3]">
            <img
              src="/src/assets/images/crop_soil_stewardship_1794715063327.jpg"
              alt="Farmer examining dark loamy agricultural soil above green legume rows"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="md:col-span-7 space-y-4">
            <p className="text-xs font-semibold text-[#8A621C]">Grounded in Soil Stewardship</p>
            <h2 className="font-display text-3xl font-semibold text-[#132A20] [text-wrap:balance]">
              Connecting orbital science to real planting calendars.
            </h2>
            <p className="text-sm sm:text-base text-[#44544B] leading-relaxed">
              Satellites cannot measure soil pH or replace your hands in the soil. FarmNova AI pairs orbital climate trends with your local soil observations, crop history, pest pressures, and market priorities—then prepares downloadable PDF and CSV briefings you can review with local agricultural extension officers.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 pt-2 text-sm text-[#2E3E35]">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#0E4D3A] shrink-0 mt-0.5" />
                <span>Polygon boundary drawing & geodesic area calculation</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Layers className="w-4 h-4 text-[#0E4D3A] shrink-0 mt-0.5" />
                <span>Hypothetical drought & heat stress scenario explorer</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#E2DDD1] py-8 px-6 text-xs text-[#5E6D64]">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-6 h-6" />
            <span>FarmNova AI · Smarter Farming. Stronger Futures.</span>
          </div>
          <span>Data provenance: NASA POWER · GPM · SMAP · MODIS GIBS · SRTM DEM</span>
        </div>
      </footer>
    </div>
  );
}
