import React, { useEffect, useState } from 'react';
import { CheckCircle2, Database, Megaphone, RefreshCw, Shield, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import type { User } from '../types';

export function AccountSettingsPanel({ user, onUserUpdated }: { user: User; onUserUpdated: (u: User) => void }) {
  const [name, setName] = useState(user.name);
  const [organization, setOrganization] = useState(user.organization);
  const [region, setRegion] = useState(user.region);
  const [preferredUnits, setPreferredUnits] = useState<'metric' | 'imperial'>(user.preferredUnits);
  const [verifyCode, setVerifyCode] = useState('');
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await api.updateProfile({ name, organization, region, preferredUnits });
      onUserUpdated(res.user);
      setMsg('Profile settings saved.');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function requestCode() {
    setErr(null);
    const res = await api.resendVerification();
    setIssuedCode(res.verificationToken);
    setVerifyCode(res.verificationToken);
  }

  async function confirmEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const res = await api.verifyEmail(user.email, verifyCode);
      if (res.user) onUserUpdated(res.user);
      setMsg('Email verified successfully.');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold text-[#132A20]">Account Profile & Permissions</h2>
        <p className="text-sm text-[#47564E] mt-1">Manage your profile identity, email verification status, and role permissions.</p>
      </div>

      {msg && <div className="p-3 rounded-lg bg-[#F1F7F4] border border-[#B8D8C8] text-xs text-[#0E4D3A]">{msg}</div>}
      {err && <div className="p-3 rounded-lg bg-[#FDF2F0] border border-[#E5B8B0] text-xs text-[#8C2D19]">{err}</div>}

      <form onSubmit={saveProfile} className="bg-white border border-[#E2DDD1] rounded-xl p-6 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Full Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Email Address</label>
            <input disabled value={user.email} className="w-full px-3 py-2 bg-[#F2EFE7] border border-[#E2DDD1] rounded-lg text-[#5E6D64]" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Organization / Cooperative</label>
            <input value={organization} onChange={(e) => setOrganization(e.target.value)} className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Primary Region</label>
            <input value={region} onChange={(e) => setRegion(e.target.value)} className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Measurement Units</label>
            <select value={preferredUnits} onChange={(e) => setPreferredUnits(e.target.value as any)} className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg">
              <option value="metric">Metric (ha, mm, °C)</option>
              <option value="imperial">Imperial (acres, in, °F)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#2E3E35] mb-1">Assigned Role</label>
            <div className="px-3 py-2 bg-[#F2EFE7] border border-[#E2DDD1] rounded-lg text-sm font-semibold capitalize text-[#0E4D3A]">
              {user.role}
            </div>
          </div>
        </div>
        <button type="submit" disabled={saving} className="px-5 py-2 bg-[#0E4D3A] text-[#FAF8F3] text-sm font-semibold rounded-lg hover:bg-[#0A3A2B]">
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </form>

      <div className="bg-white border border-[#E2DDD1] rounded-xl p-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#132A20]">Email Verification</h3>
            <p className="text-xs text-[#5E6D64] mt-0.5">
              Status: {user.verified ? 'Verified Account' : 'Verification Pending'}
            </p>
          </div>
          {user.verified ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E4D3A]">
              <CheckCircle2 className="w-4 h-4" /> Verified
            </span>
          ) : (
            <button type="button" onClick={requestCode} className="px-3 py-1.5 text-xs font-semibold border border-[#0E4D3A] text-[#0E4D3A] rounded-lg">
              Generate Verification Code
            </button>
          )}
        </div>

        {!user.verified && (
          <form onSubmit={confirmEmail} className="flex flex-wrap items-center gap-2 pt-2">
            {issuedCode && <div className="w-full text-xs font-mono text-[#0E4D3A]">Issued code: {issuedCode}</div>}
            <input
              type="text"
              required
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="Enter verification code"
              className="px-3 py-2 text-xs font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
            />
            <button type="submit" className="px-4 py-2 text-xs font-semibold bg-[#0E4D3A] text-white rounded-lg">
              Verify Now
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function AdminDashboardPanel({ onAnnouncementsChanged }: { onAnnouncementsChanged: () => Promise<void> }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'users' | 'farms' | 'datasets' | 'ai' | 'announcements' | 'audit'>('users');
  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annSeverity, setAnnSeverity] = useState('info');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.adminOverview();
      setData(res);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading || !data) {
    return <div className="p-8 text-sm text-[#5E6D64]">Loading administration telemetry...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#132A20]">Platform Administration Console</h2>
          <p className="text-sm text-[#47564E] mt-1">Manage user roles, NASA dataset configurations, AI guardrails, system health, and audit logs.</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            await api.adminClearCache();
            setStatusMsg('Cleared NASA observation cache.');
            await load();
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-[#D8D2C3] bg-white hover:border-[#0E4D3A]"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Clear NASA Cache ({data.health.cachedGeospatialQueries})
        </button>
      </div>

      {statusMsg && <div className="p-3 rounded-lg bg-[#F1F7F4] border border-[#B8D8C8] text-xs text-[#0E4D3A]">{statusMsg}</div>}

      {/* System Health Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
          <div className="text-xs text-[#5E6D64]">Registered Users</div>
          <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">{data.users.length}</div>
        </div>
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
          <div className="text-xs text-[#5E6D64]">Registered Farms</div>
          <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">{data.farms.length}</div>
        </div>
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
          <div className="text-xs text-[#5E6D64]">Crop Catalog</div>
          <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">{data.health.cropCatalogCount}</div>
        </div>
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
          <div className="text-xs text-[#5E6D64]">AI Queries Logged</div>
          <div className="font-mono text-2xl font-semibold text-[#132A20] mt-1">{data.health.totalChatInteractions}</div>
        </div>
        <div className="bg-white border border-[#E2DDD1] rounded-xl p-4">
          <div className="text-xs text-[#5E6D64]">Server Status</div>
          <div className="text-sm font-semibold text-[#0E4D3A] mt-2">{data.health.database}</div>
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1 p-1 bg-[#EAE4D7] rounded-lg text-xs">
        {(
          [
            ['users', 'Users & Roles'],
            ['farms', 'Registered Farms'],
            ['datasets', 'NASA Data Sources'],
            ['ai', 'AI Settings'],
            ['announcements', 'Announcements'],
            ['audit', 'Audit Logs'],
          ] as const
        ).map(([id, lbl]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
              tab === id ? 'bg-white text-[#132A20] shadow-xs' : 'text-[#5A665E]'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2DDD1] bg-[#FAF8F3]">
                <th className="py-3 px-4 font-semibold">User</th>
                <th className="py-3 px-4 font-semibold">Organization & Region</th>
                <th className="py-3 px-4 font-semibold">Role</th>
                <th className="py-3 px-4 font-semibold">Verified</th>
                <th className="py-3 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE8DD]">
              {data.users.map((u: any) => (
                <tr key={u.id}>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#132A20]">{u.name}</div>
                    <div className="text-[#5E6D64]">{u.email}</div>
                  </td>
                  <td className="py-3 px-4 text-[#47564E]">{u.organization || '—'} · {u.region || '—'}</td>
                  <td className="py-3 px-4">
                    <select
                      value={u.role}
                      onChange={async (e) => {
                        await api.adminUpdateUser(u.id, { role: e.target.value });
                        await load();
                      }}
                      className="px-2 py-1 bg-[#FAF8F3] border border-[#D8D2C3] rounded"
                    >
                      <option value="farmer">farmer</option>
                      <option value="expert">expert</option>
                      <option value="researcher">researcher</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.adminUpdateUser(u.id, { verified: !u.verified });
                        await load();
                      }}
                      className={`font-semibold ${u.verified ? 'text-[#0E4D3A]' : 'text-[#9A6A16]'}`}
                    >
                      {u.verified ? 'Verified' : 'Pending'}
                    </button>
                  </td>
                  <td className="py-3 px-4">
                    <button
                      type="button"
                      onClick={async () => {
                        await api.adminUpdateUser(u.id, { active: !u.active });
                        await load();
                      }}
                      className={`font-semibold ${u.active ? 'text-[#0E4D3A]' : 'text-[#9E2F1B]'}`}
                    >
                      {u.active ? 'Active' : 'Suspended'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'farms' && (
        <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-x-auto">
          <div className="px-4 py-3 border-b border-[#ECE8DD] text-xs text-[#5E6D64]">
            Governance overview showing farm geographies only; private farmer soil, pest, and crop notes remain strictly isolated per owner.
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2DDD1] bg-[#FAF8F3]">
                <th className="py-3 px-4 font-semibold">Farm ID / Title</th>
                <th className="py-3 px-4 font-semibold">Location</th>
                <th className="py-3 px-4 font-semibold">Coordinates</th>
                <th className="py-3 px-4 font-semibold">Size (ha)</th>
                <th className="py-3 px-4 font-semibold">System Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE8DD]">
              {data.farms.map((f: any) => (
                <tr key={f.id}>
                  <td className="py-3 px-4 font-semibold text-[#132A20]">{f.name}</td>
                  <td className="py-3 px-4">{f.district}, {f.region}, {f.country}</td>
                  <td className="py-3 px-4 font-mono">{Number(f.centroid_lat).toFixed(4)}, {Number(f.centroid_lon).toFixed(4)}</td>
                  <td className="py-3 px-4 font-mono">{f.size_hectares}</td>
                  <td className="py-3 px-4 text-[#47564E]">{f.farming_type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'datasets' && (
        <div className="space-y-3">
          {data.datasets.map((ds: any) => (
            <div key={ds.id} className="bg-white border border-[#E2DDD1] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
              <div className="space-y-1">
                <div className="font-semibold text-[#132A20] flex items-center gap-2">
                  <Database className="w-3.5 h-3.5 text-[#0E4D3A]" />
                  {ds.mission_code} · {ds.dataset_name}
                </div>
                <div className="text-[#5E6D64]">{ds.spatial_resolution} · {ds.temporal_resolution}</div>
                <div className="text-[#47564E]">{ds.limitations}</div>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await api.adminUpdateDataset(ds.id, { enabled: !ds.enabled });
                  await load();
                }}
                className={`px-3 py-1.5 rounded-lg font-semibold shrink-0 ${
                  ds.enabled ? 'bg-[#0E4D3A] text-white' : 'bg-[#F2EFE7] text-[#5E6D64]'
                }`}
              >
                {ds.enabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'ai' && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget as any;
            await api.adminUpdateAiSettings({
              modelName: form.modelName.value,
              systemTone: form.systemTone.value,
              strictScientificDisclaimer: form.strictDisclaimer.checked,
              maxHistoryTurns: Number(form.maxTurns.value),
            });
            setStatusMsg('AI Assistant configuration updated.');
            await load();
          }}
          className="bg-white border border-[#E2DDD1] rounded-xl p-6 space-y-4 text-xs max-w-xl"
        >
          <div>
            <label className="block font-semibold mb-1">Gemini Model Selection</label>
            <select name="modelName" defaultValue={data.aiSettings.model_name} className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg">
              <option value="gemini-4-hydrogen">gemini-4-hydrogen (Recommended Agronomic Reasoning)</option>
              <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Low-Latency Responses)</option>
            </select>
          </div>
          <div>
            <label className="block font-semibold mb-1">Assistant Tone Instruction</label>
            <input name="systemTone" defaultValue={data.aiSettings.system_tone} className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg" />
          </div>
          <div>
            <label className="block font-semibold mb-1">Conversation Memory Window (Turns)</label>
            <input type="number" name="maxTurns" min={4} max={24} defaultValue={data.aiSettings.max_history_turns} className="w-full px-3 py-2 font-mono bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg" />
          </div>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="strictDisclaimer" defaultChecked={Boolean(data.aiSettings.strict_scientific_disclaimer)} />
            Require explicit mention of missing local soil/field data in responses
          </label>
          <button type="submit" className="px-4 py-2 bg-[#0E4D3A] text-white font-semibold rounded-lg">
            Save AI Settings
          </button>
        </form>
      )}

      {tab === 'announcements' && (
        <div className="space-y-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await api.adminCreateAnnouncement({ title: annTitle, body: annBody, severity: annSeverity });
              setAnnTitle('');
              setAnnBody('');
              await load();
              await onAnnouncementsChanged();
            }}
            className="bg-white border border-[#E2DDD1] rounded-xl p-5 space-y-3 text-xs"
          >
            <div className="font-semibold text-[#132A20] flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-[#0E4D3A]" /> Publish Platform Advisory
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <input
                required
                value={annTitle}
                onChange={(e) => setAnnTitle(e.target.value)}
                placeholder="Announcement headline"
                className="sm:col-span-2 px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
              />
              <select value={annSeverity} onChange={(e) => setAnnSeverity(e.target.value)} className="px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg">
                <option value="info">Information</option>
                <option value="advisory">Seasonal Advisory</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
            <textarea
              required
              rows={2}
              value={annBody}
              onChange={(e) => setAnnBody(e.target.value)}
              placeholder="Write seasonal satellite or agronomic platform notice..."
              className="w-full px-3 py-2 bg-[#FAF8F3] border border-[#D8D2C3] rounded-lg"
            />
            <button type="submit" className="px-4 py-2 bg-[#0E4D3A] text-white font-semibold rounded-lg">
              Publish Announcement
            </button>
          </form>

          <div className="space-y-2">
            {data.announcements.map((a: any) => (
              <div key={a.id} className="bg-white border border-[#E2DDD1] rounded-xl p-4 flex items-start justify-between gap-4 text-xs">
                <div>
                  <div className="font-semibold text-[#132A20]">{a.title}</div>
                  <p className="text-[#47564E] mt-0.5">{a.body}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await api.adminDeleteAnnouncement(a.id);
                    await load();
                    await onAnnouncementsChanged();
                  }}
                  className="text-[#8C2D19] hover:underline shrink-0 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="bg-white border border-[#E2DDD1] rounded-xl overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E2DDD1] bg-[#FAF8F3]">
                <th className="py-3 px-4 font-semibold">Timestamp</th>
                <th className="py-3 px-4 font-semibold">Actor</th>
                <th className="py-3 px-4 font-semibold">Action</th>
                <th className="py-3 px-4 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ECE8DD]">
              {data.auditLogs.map((log: any) => (
                <tr key={log.id}>
                  <td className="py-2.5 px-4 font-mono text-[#5E6D64] whitespace-nowrap">{log.created_at.slice(0, 19).replace('T', ' ')}</td>
                  <td className="py-2.5 px-4">{log.user_email}</td>
                  <td className="py-2.5 px-4 font-mono font-semibold text-[#132A20]">{log.action}</td>
                  <td className="py-2.5 px-4 text-[#47564E]">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
