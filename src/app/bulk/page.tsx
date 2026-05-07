'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Lead } from '@/lib/types';
import { US_STATES } from '@/lib/us-states';
import { Play, Pause, Download, Save, CheckCircle2, Loader2, Mail, RotateCcw } from 'lucide-react';

const POPULAR_INDUSTRIES = [
  'Nail Salon', 'Hair Salon', 'Barber Shop', 'Spa & Massage', 'Beauty Supply',
  'Lash & Brow Studio', 'Waxing Salon', 'Tanning Salon', 'Med Spa',
  'Dentist', 'Chiropractor', 'Veterinarian', 'Optometrist', 'Pharmacy',
  'Restaurant', 'Coffee Shop', 'Bakery', 'Bar & Nightclub', 'Food Truck',
  'Auto Repair', 'Car Wash', 'Car Dealership',
  'Real Estate Agent', 'Insurance Agent', 'Accountant', 'Lawyer',
  'Gym & Fitness', 'Yoga Studio', 'Martial Arts', 'Personal Trainer',
  'Daycare', 'Pet Grooming', 'Dog Walker',
  'Plumber', 'Electrician', 'HVAC', 'Roofing', 'Landscaping', 'Cleaning Service',
  'Photography Studio', 'Tattoo Shop', 'Florist', 'Dry Cleaner',
];

interface ProjectInfo { id: string; name: string; emoji: string; color: string; description: string; connected: boolean; }

interface StateResult {
  stateCode: string;
  stateName: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  count: number;
  error?: string;
  drilled?: boolean;
  drilledCities?: string[];
}

type BulkMode = 'yelp' | 'apify';

export default function BulkScrape() {
  const [industry, setIndustry] = useState('');
  const [mode, setMode] = useState<BulkMode>('yelp');
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set(US_STATES.map(s => s.code)));

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const pauseRef = useRef(false);
  const abortRef = useRef(false);

  const [stateResults, setStateResults] = useState<Map<string, StateResult>>(new Map());
  const [allLeads, setAllLeads] = useState<Lead[]>([]);
  const [currentState, setCurrentState] = useState<string | null>(null);
  const [drillLog, setDrillLog] = useState<string[]>([]);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState('glowup');
  const [saveStatus, setSaveStatus] = useState('');

  // Email enrichment state
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, found: 0 });
  const enrichAbortRef = useRef(false);

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.projects) setProjects(d.projects.filter((p: ProjectInfo) => p.id !== 'csv_only' && p.connected));
    }).catch(() => {});
  }, []);

  const totalSelected = selectedStates.size;
  const completed = Array.from(stateResults.values()).filter(r => r.status === 'done' || r.status === 'error').length;
  const uniqueCount = allLeads.length;
  const emailCount = allLeads.filter(l => l.email).length;
  const progressPct = totalSelected > 0 ? Math.round((completed / totalSelected) * 100) : 0;

  const toggleState = (code: string) => {
    setSelectedStates(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };

  const saveToProject = useCallback(async (leads: Lead[]) => {
    if (leads.length === 0 || selectedProject === 'csv_only') return;
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads, projectId: selectedProject }),
      });
      const data = await res.json();
      if (data.success) setSaveStatus(`Saved ${data.count} new (${data.duplicates} dupes skipped)`);
    } catch {
      setSaveStatus('Save failed');
    }
  }, [selectedProject]);

  const startBulkScrape = async () => {
    setIsRunning(true);
    setIsPaused(false);
    pauseRef.current = false;
    abortRef.current = false;

    const statesToScrape = US_STATES.filter(s => selectedStates.has(s.code));
    const initResults = new Map<string, StateResult>();
    statesToScrape.forEach(s => {
      const existing = stateResults.get(s.code);
      if (existing?.status === 'done') initResults.set(s.code, existing);
      else initResults.set(s.code, { stateCode: s.code, stateName: s.name, status: 'pending', count: 0 });
    });
    setStateResults(initResults);

    for (const state of statesToScrape) {
      if (abortRef.current) break;
      const existing = initResults.get(state.code);
      if (existing?.status === 'done') continue;

      while (pauseRef.current && !abortRef.current) {
        await new Promise(r => setTimeout(r, 300));
      }
      if (abortRef.current) break;

      setCurrentState(state.code);
      setStateResults(prev => {
        const next = new Map(prev);
        next.set(state.code, { ...next.get(state.code)!, status: 'running' });
        return next;
      });

      try {
        const res = await fetch('/api/search/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ industry, stateCode: state.code, stateName: state.name, country: 'US', mode, maxPerState: mode === 'yelp' ? 1000 : 500 }),
        });

        const data = await res.json();

        if (data.leads && data.leads.length > 0) {
          setAllLeads(prev => {
            const existingNames = new Set(prev.map(l => `${l.business_name}::${l.city}`.toLowerCase()));
            const newLeads = data.leads.filter((l: Lead) => !existingNames.has(`${l.business_name}::${l.city}`.toLowerCase()));
            return [...prev, ...newLeads];
          });

          if (selectedProject !== 'csv_only') await saveToProject(data.leads);

          setStateResults(prev => {
            const next = new Map(prev);
            next.set(state.code, { stateCode: state.code, stateName: state.name, status: 'done', count: data.leads.length, drilled: data.drilled, drilledCities: data.drilledCities });
            return next;
          });

          if (data.drilled && data.drilledCities?.length > 0) {
            setDrillLog(prev => [...prev, `🔍 ${state.name}: drilled ${data.drilledCities.length} cities → ${data.leads.length} unique`]);
          }
        } else {
          const hasError = data.error || !res.ok;
          setStateResults(prev => {
            const next = new Map(prev);
            next.set(state.code, { stateCode: state.code, stateName: state.name, status: hasError ? 'error' : 'done', count: 0, error: data.error });
            return next;
          });
          if (data.error) {
            setDrillLog(prev => [...prev, `❌ ${state.name}: ${data.error}`]);
          }
        }
      } catch (err: any) {
        setStateResults(prev => {
          const next = new Map(prev);
          next.set(state.code, { stateCode: state.code, stateName: state.name, status: 'error', count: 0, error: err.message });
          return next;
        });
        setDrillLog(prev => [...prev, `❌ ${state.name}: ${err.message}`]);
      }

      if (mode === 'yelp') await new Promise(r => setTimeout(r, 500));
    }

    setCurrentState(null);
    setIsRunning(false);
  };

  const handleReset = () => {
    setStateResults(new Map());
    setAllLeads([]);
    setCurrentState(null);
    setSaveStatus('');
    setDrillLog([]);
    setEnrichProgress({ done: 0, total: 0, found: 0 });
  };

  const handleEnrichEmails = async () => {
    const leadsToEnrich = allLeads.filter(l => l.website && !l.email);
    if (leadsToEnrich.length === 0) return;

    setIsEnriching(true);
    enrichAbortRef.current = false;
    setEnrichProgress({ done: 0, total: leadsToEnrich.length, found: 0 });

    const BATCH = 10;
    let totalFound = 0;

    for (let i = 0; i < leadsToEnrich.length; i += BATCH) {
      if (enrichAbortRef.current) break;
      const batch = leadsToEnrich.slice(i, i + BATCH);

      try {
        const res = await fetch('/api/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leads: batch, batchSize: 5 }) });
        const data = await res.json();
        if (data.results) {
          setAllLeads(prev => {
            const updated = [...prev];
            for (const r of data.results) {
              if (r.email) {
                const lead = updated.find(l => l.business_name === r.business_name && l.website === r.website);
                if (lead) lead.email = r.email;
              }
            }
            return updated;
          });
          totalFound += data.enriched || 0;
        }
      } catch { /* continue */ }

      setEnrichProgress({ done: Math.min(i + BATCH, leadsToEnrich.length), total: leadsToEnrich.length, found: totalFound });
    }

    setIsEnriching(false);
    setDrillLog(prev => [...prev, `📧 Email enrichment: found ${totalFound} emails from ${leadsToEnrich.length} websites`]);
  };

  const handleExportCSV = () => {
    if (allLeads.length === 0) return;
    const headers = ['Business Name', 'Industry', 'Address', 'City', 'State', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'Google Maps URL', 'Source'];
    const rows = allLeads.map(l => [
      `"${(l.business_name || '').replace(/"/g, '""')}"`, `"${l.industry || ''}"`, `"${(l.address || '').replace(/"/g, '""')}"`,
      `"${l.city || ''}"`, `"${l.state || ''}"`, `"${l.phone || ''}"`, `"${l.email || ''}"`, `"${l.website || ''}"`,
      `"${l.rating || ''}"`, `"${l.review_count || ''}"`, `"${l.google_maps_url || ''}"`, `"${l.source || ''}"`
    ].join(','));
    const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `infoiq_bulk_${industry.replace(/\s+/g, '_')}_US.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const enrichableCount = allLeads.filter(l => l.website && !l.email).length;

  return (
    <div className="page-container">
      {/* Top bar */}
      <div className="topbar">
        <div>
          <h1>Bulk Scrape</h1>
          <div className="topbar-subtitle">Automate state-by-state lead collection across the US</div>
        </div>
      </div>

      {/* Config */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Row 1: Industry */}
          <div>
            <div className="input-group">
              <label className="input-label">Industry</label>
              <input value={industry} onChange={e => setIndustry(e.target.value)} disabled={isRunning} className="input-field" placeholder="Type or select..." list="bulk-industry-list" />
              <datalist id="bulk-industry-list">
                {POPULAR_INDUSTRIES.map(i => <option key={i} value={i} />)}
              </datalist>
            </div>
          </div>

          {/* Row 2: States */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span className="input-label">States ({selectedStates.size}/51)</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setSelectedStates(new Set(US_STATES.map(s => s.code)))} disabled={isRunning} className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 8px' }}>
                  Select All
                </button>
                <button onClick={() => setSelectedStates(new Set())} disabled={isRunning} className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 8px' }}>
                  Clear
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {US_STATES.map(s => {
                const result = stateResults.get(s.code);
                const statusClass = result?.status === 'done' ? 'done'
                  : result?.status === 'running' ? 'running'
                  : result?.status === 'error' ? 'error'
                  : selectedStates.has(s.code) ? 'selected' : '';

                return (
                  <button key={s.code} onClick={() => !isRunning && toggleState(s.code)} disabled={isRunning}
                    className={`state-chip ${statusClass}`}
                    title={`${s.name}${result?.count ? ` — ${result.count} found` : ''}${result?.drilled ? ' (city-drilled)' : ''}`}>
                    {s.code}
                    {result?.status === 'done' && result.count > 0 && <span style={{ fontSize: '10px', opacity: 0.7 }}>({result.count})</span>}
                    {result?.drilled && <span style={{ fontSize: '9px' }}>🔍</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Mode + Save To + Actions */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'end', flexWrap: 'wrap' }}>
            <div className="input-group">
              <label className="input-label">Mode</label>
              <div className="mode-toggle">
                <button onClick={() => !isRunning && setMode('yelp')} className={mode === 'yelp' ? 'active' : ''}>
                  Yelp <span style={{ fontSize: '10px', opacity: 0.7 }}>FREE</span>
                </button>
                <button onClick={() => !isRunning && setMode('apify')} className={mode === 'apify' ? 'active' : ''}>
                  Apify <span style={{ fontSize: '10px', opacity: 0.7 }}>+EMAIL</span>
                </button>
              </div>
            </div>

            <div className="input-group">
              <label className="input-label">Save to</label>
              <select
                value={selectedProject}
                onChange={(e) => setSelectedProject(e.target.value)}
                disabled={isRunning}
                className="input-field"
                style={{ fontSize: '13px', minWidth: '140px' }}
              >
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
                ))}
              </select>
            </div>

            {!isRunning ? (
              <>
                <button onClick={startBulkScrape} disabled={selectedStates.size === 0 || !industry} className="btn btn-primary" style={{ marginTop: 'auto', marginLeft: 'auto' }}>
                  <Play className="w-4 h-4" /> Start Bulk Scrape
                </button>
                {allLeads.length > 0 && (
                  <>
                    {!isEnriching ? (
                      <button onClick={handleEnrichEmails} disabled={enrichableCount === 0} className="btn btn-secondary">
                        <Mail className="w-4 h-4" /> Enrich Emails ({enrichableCount})
                      </button>
                    ) : (
                      <button onClick={() => { enrichAbortRef.current = true; }} className="btn btn-secondary">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {enrichProgress.done}/{enrichProgress.total} ({enrichProgress.found} found)
                      </button>
                    )}
                    <button onClick={handleExportCSV} className="btn btn-secondary">
                      <Download className="w-4 h-4" /> CSV ({allLeads.length})
                    </button>
                    <button onClick={handleReset} className="btn btn-ghost" style={{ fontSize: '12px' }}>
                      <RotateCcw className="w-3.5 h-3.5" /> Reset
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <button onClick={() => { pauseRef.current = !pauseRef.current; setIsPaused(!isPaused); }}
                  className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`} style={{ borderColor: 'rgba(255,170,0,0.3)' }}>
                  {isPaused ? <><Play className="w-4 h-4" /> Resume</> : <><Pause className="w-4 h-4" /> Pause</>}
                </button>
                <button onClick={() => { abortRef.current = true; pauseRef.current = false; setIsPaused(false); }} className="btn btn-ghost" style={{ color: 'var(--danger)' }}>
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress */}
      {(isRunning || allLeads.length > 0) && (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Progress bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600 }}>
                  {isRunning ? (isPaused ? '⏸ Paused' : `Scraping ${currentState || '...'}`) : `✅ Complete${drillLog.length > 0 ? ` (${drillLog.length} drilled)` : ''}`}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {completed}/{totalSelected} states · {progressPct}%
                </span>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div className="stat-card">
                <div className="stat-value">{uniqueCount.toLocaleString()}</div>
                <div className="stat-label">Unique Leads</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--success)' }}>{emailCount}</div>
                <div className="stat-label">With Email</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--accent-light)' }}>{completed}</div>
                <div className="stat-label">States Done</div>
              </div>
              <div className="stat-card">
                <div className="stat-value" style={{ color: 'var(--warning)' }}>{drillLog.length}</div>
                <div className="stat-label">Cities Drilled</div>
              </div>
            </div>

            {/* Save status */}
            {saveStatus && (
              <div style={{ fontSize: '12px', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <CheckCircle2 className="w-3 h-3" /> {saveStatus}
              </div>
            )}

            {/* Drill log */}
            {drillLog.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>Activity Log</div>
                <div style={{ maxHeight: '120px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {drillLog.map((log, i) => (
                    <div key={i} style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
