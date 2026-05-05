'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Lead } from '@/lib/types';
import { Loader2, Download, Star, Mail, ExternalLink, Trash2, ChevronLeft, ChevronRight, Search, MapPin, X, Zap, Shield, ChevronDown, Check, RotateCcw } from 'lucide-react';

interface ProjectInfo { id: string; name: string; emoji: string; color: string; description: string; connected: boolean; }
interface FilterOption { value: string; count: number; }

// ── Multi-Select Checkbox Dropdown ──
function MultiSelectDropdown({ label, options, selected, onChange, allLabel }: {
  label: string; options: FilterOption[]; selected: string[]; onChange: (v: string[]) => void; allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  useEffect(() => { if (open && searchRef.current) searchRef.current.focus(); if (!open) setSearch(''); }, [open]);
  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };
  const selectedTotal = selected.reduce((sum, val) => {
    const opt = options.find(o => o.value === val);
    return sum + (opt?.count || 0);
  }, 0);
  const displayText = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? `${selected[0]} (${selectedTotal.toLocaleString()})`
      : `${selected.length} selected (${selectedTotal.toLocaleString()})`;
  const filtered = search
    ? options.filter(o => o.value.toLowerCase().includes(search.toLowerCase()))
    : options;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} className="input-field" style={{
        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', padding: '6px 10px', minWidth: '120px',
        cursor: 'pointer', background: selected.length > 0 ? 'rgba(124,131,219,0.08)' : undefined,
        borderColor: selected.length > 0 ? 'rgba(124,131,219,0.3)' : undefined, whiteSpace: 'nowrap',
      }}>
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayText}</span>
        {selected.length > 0 && (
          <X className="w-3 h-3" style={{ color: 'var(--text-muted)', flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onChange([]); }} />
        )}
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '4px', minWidth: '240px', maxHeight: '360px',
          display: 'flex', flexDirection: 'column', background: '#1a1a2e', border: '1px solid var(--border)', borderRadius: '8px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', zIndex: 100,
        }}>
          {/* Search input */}
          <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              style={{
                width: '100%', padding: '6px 10px', fontSize: '12px', border: '1px solid var(--border)',
                borderRadius: '6px', background: 'rgba(255,255,255,0.04)', color: 'var(--text-primary)',
                outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            />
          </div>
          {/* Options list */}
          <div style={{ overflowY: 'auto', padding: '4px 0', flex: 1 }}>
            {filtered.map(opt => {
              const isSelected = selected.includes(opt.value);
              return (
                <div key={opt.value} onClick={() => toggle(opt.value)} style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 12px', cursor: 'pointer',
                  fontSize: '12px', color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                  background: isSelected ? 'rgba(124,131,219,0.06)' : undefined,
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? 'rgba(124,131,219,0.06)' : '')}
                >
                  <div style={{
                    width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: isSelected ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                    background: isSelected ? 'rgba(124,131,219,0.15)' : 'transparent',
                  }}>
                    {isSelected && <Check className="w-3 h-3" style={{ color: 'var(--accent)' }} />}
                  </div>
                  <span style={{ flex: 1 }}>{opt.value}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({opt.count.toLocaleString()})</span>
                </div>
              );
            })}
            {filtered.length === 0 && <div style={{ padding: '12px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 100;

export default function SavedLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLeads, setTotalLeads] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);

  // Filters (multi-select for industry/state/city)
  const [industryFilter, setIndustryFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);
  const [cityFilter, setCityFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [emailFilter, setEmailFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Filter options from API
  const [industries, setIndustries] = useState<FilterOption[]>([]);
  const [states, setStates] = useState<FilterOption[]>([]);
  const [cities, setCities] = useState<FilterOption[]>([]);
  const [dbTotalLeads, setDbTotalLeads] = useState(0);
  const [dbWithEmail, setDbWithEmail] = useState(0);

  // Project
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState('glowup');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Enrichment
  const [enrichableCount, setEnrichableCount] = useState(0);
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ processed: 0, found: 0, total: 0 });
  const [enrichMode, setEnrichMode] = useState<'standard' | 'deep'>('standard');
  const [enrichSourceStats, setEnrichSourceStats] = useState<Record<string, number>>({});
  const [showApifyConfirm, setShowApifyConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [enrichDone, setEnrichDone] = useState<{ processed: number; found: number; sources: Record<string, number> } | null>(null);
  const enrichAbortRef = useRef(false);

  // Load projects
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.projects) {
        const dbProjects = d.projects.filter((p: ProjectInfo) => p.id !== 'csv_only' && p.connected);
        setProjects(dbProjects);
        if (dbProjects.length > 0) setSelectedProject(dbProjects[0].id);
      }
    }).catch(() => {});
  }, []);

  // Load filter options
  const fetchFilters = useCallback(async () => {
    try {
      const params = new URLSearchParams({ projectId: selectedProject });
      if (stateFilter.length > 0) params.set('state', stateFilter.join(','));
      const res = await fetch(`/api/leads/filters?${params}`);
      const data = await res.json();
      setIndustries(data.industries || []);
      setStates(data.states || []);
      setCities(data.cities || []);
      setDbTotalLeads(data.totalLeads || 0);
      setDbWithEmail(data.withEmail || 0);
    } catch {}
  }, [selectedProject, stateFilter]);

  useEffect(() => { fetchFilters(); }, [fetchFilters]);

  // When state changes, reset city
  useEffect(() => { setCityFilter([]); setPage(1); }, [stateFilter]);
  useEffect(() => { setPage(1); }, [industryFilter, cityFilter, statusFilter, emailFilter, searchQuery]);

  // Fetch leads with server-side filters
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId: selectedProject, page: String(page), pageSize: String(PAGE_SIZE) });
      if (industryFilter.length > 0) params.set('industry', industryFilter.join(','));
      if (stateFilter.length > 0) params.set('state', stateFilter.join(','));
      if (cityFilter.length > 0) params.set('city', cityFilter.join(','));
      if (statusFilter) params.set('status', statusFilter);
      if (emailFilter) params.set('hasEmail', emailFilter);
      if (searchQuery) params.set('search', searchQuery);
      const res = await fetch(`/api/leads?${params}`);
      const data = await res.json();
      setLeads(data.leads || []);
      setTotalLeads(data.total || 0);
      setTotalPages(data.totalPages || 1);
    } catch { setLeads([]); } finally { setLoading(false); }
  }, [selectedProject, page, industryFilter, stateFilter, cityFilter, statusFilter, emailFilter, searchQuery]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // Enrichment count — respects active filters
  useEffect(() => {
    const params = new URLSearchParams({ projectId: selectedProject });
    if (industryFilter.length > 0) params.set('industry', industryFilter.join(','));
    if (stateFilter.length > 0) params.set('state', stateFilter.join(','));
    if (cityFilter.length > 0) params.set('city', cityFilter.join(','));
    fetch(`/api/enrich/batch?${params}`)
      .then(r => r.json()).then(d => setEnrichableCount(d.enrichable || 0)).catch(() => setEnrichableCount(0));
  }, [selectedProject, industryFilter, stateFilter, cityFilter]);

  const handleStatusChange = async (id: string, newStatus: string) => {
    setUpdatingId(id);
    try {
      const res = await fetch('/api/leads', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status: newStatus, projectId: selectedProject }) });
      const data = await res.json();
      if (data.success) setLeads(prev => prev.map(l => l.id === id ? { ...l, status: newStatus as Lead['status'] } : l));
    } catch {} finally { setUpdatingId(null); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" from your database?`)) return;
    try {
      const res = await fetch('/api/leads', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, projectId: selectedProject }) });
      const data = await res.json();
      if (data.success) { setLeads(prev => prev.filter(l => l.id !== id)); setTotalLeads(prev => prev - 1); }
    } catch {}
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportCSV = async () => {
    if (totalLeads === 0) return;
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ projectId: selectedProject });
      if (industryFilter.length > 0) params.set('industry', industryFilter.join(','));
      if (stateFilter.length > 0) params.set('state', stateFilter.join(','));
      if (cityFilter.length > 0) params.set('city', cityFilter.join(','));
      if (statusFilter) params.set('status', statusFilter);
      if (emailFilter) params.set('hasEmail', emailFilter);
      if (searchQuery) params.set('search', searchQuery);

      const res = await fetch(`/api/leads/export?${params}`);
      if (!res.ok) throw new Error('Export failed');

      // Build descriptive filename
      const parts: string[] = ['InfoIQ'];
      if (industryFilter.length > 0) parts.push(industryFilter.join('-').replace(/\s+/g, ''));
      if (stateFilter.length > 0) parts.push(stateFilter.join('-'));
      if (cityFilter.length > 0) parts.push(cityFilter.join('-').replace(/\s+/g, ''));
      if (emailFilter === 'yes') parts.push('WithEmail');
      if (emailFilter === 'no') parts.push('NoEmail');
      if (statusFilter) parts.push(statusFilter.replace(/\s+/g, ''));
      if (parts.length === 1) parts.push('AllLeads');
      parts.push(`${totalLeads}leads`);
      parts.push(new Date().toISOString().slice(0, 10));
      const filename = parts.join('_') + '.csv';

      const csvBlob = new Blob([await res.arrayBuffer()], { type: 'text/csv' });

      // Use native Save As dialog — guarantees filename
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (window as any).showSaveFilePicker === 'function') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(csvBlob);
          await writable.close();
        } catch (e: unknown) {
          if (e instanceof Error && e.name !== 'AbortError') throw e;
        }
      } else {
        // Fallback for older browsers
        const url = window.URL.createObjectURL(csvBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { window.URL.revokeObjectURL(url); document.body.removeChild(a); }, 10000);
      }
    } catch (err) { console.error('Export error:', err); }
    setIsExporting(false);
  };

  const handleEnrichEmails = async (useApify = false) => {
    if (useApify) {
      setShowApifyConfirm(true);
      return;
    }
    startEnrichment(false);
  };

  const handleResetEnrichment = async () => {
    setIsResetting(true);
    try {
      const body: Record<string, string> = { projectId: selectedProject };
      if (industryFilter.length > 0) body.industry = industryFilter.join(',');
      if (stateFilter.length > 0) body.state = stateFilter.join(',');
      if (cityFilter.length > 0) body.city = cityFilter.join(',');
      const res = await fetch('/api/enrich/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      console.log(`Reset enrichment: ${data.reset} leads reset`);
      // Always refresh enrichable count
      const params = new URLSearchParams({ projectId: selectedProject });
      if (industryFilter.length > 0) params.set('industry', industryFilter.join(','));
      if (stateFilter.length > 0) params.set('state', stateFilter.join(','));
      if (cityFilter.length > 0) params.set('city', cityFilter.join(','));
      const countRes = await fetch(`/api/enrich/batch?${params}`);
      const countData = await countRes.json();
      setEnrichableCount(countData.enrichable || 0);
    } catch (err) {
      console.error('Reset enrichment error:', err);
    } finally {
      setIsResetting(false);
    }
  };

  const startEnrichment = async (enableApify: boolean) => {
    setShowApifyConfirm(false);
    setIsEnriching(true);
    setEnrichDone(null);
    enrichAbortRef.current = false;
    setEnrichProgress({ processed: 0, found: 0, total: enrichableCount });
    setEnrichSourceStats({});
    let offset = 0; const BATCH_LIMIT = 30; let totalFound = 0; let totalProcessed = 0;
    const cumulativeStats: Record<string, number> = {};
    while (!enrichAbortRef.current) {
      try {
        const res = await fetch('/api/enrich/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: selectedProject,
            batchSize: 3,
            offset,
            limit: BATCH_LIMIT,
            industry: industryFilter.length > 0 ? industryFilter.join(',') : undefined,
            state: stateFilter.length > 0 ? stateFilter.join(',') : undefined,
            city: cityFilter.length > 0 ? cityFilter.join(',') : undefined,
            enableGoogle: true,
            enableSocial: true,
            enableApify,
          }),
        });
        const data = await res.json();
        if (data.error) break;
        totalProcessed += data.processed || 0;
        totalFound += data.enriched || 0;
        if (data.sourceStats) {
          for (const [k, v] of Object.entries(data.sourceStats)) {
            cumulativeStats[k] = (cumulativeStats[k] || 0) + (v as number);
          }
          setEnrichSourceStats({ ...cumulativeStats });
        }
        setEnrichProgress({ processed: totalProcessed, found: totalFound, total: data.totalEnrichable || enrichableCount });
        if (data.results?.length > 0) {
          setLeads(prev => { const u = [...prev]; for (const r of data.results) { const l = u.find((x: any) => x.id === r.id); if (l) l.email = r.email; } return u; });
        }
        if (data.done) break;
        offset += BATCH_LIMIT;
      } catch { break; }
    }
    setIsEnriching(false);
    setEnrichDone({ processed: totalProcessed, found: totalFound, sources: { ...cumulativeStats } });
    setEnrichableCount(prev => Math.max(0, prev - totalProcessed));
    // Refresh leads list and filters to reflect new emails
    fetchLeads();
    fetchFilters();
  };

  const handleSearch = () => { setSearchQuery(searchInput); };

  const emailCount = leads.filter(l => l.email).length;
  const currentProject = projects.find(p => p.id === selectedProject);
  const activeFilterCount = [industryFilter.length > 0, stateFilter.length > 0, cityFilter.length > 0, statusFilter, emailFilter, searchQuery].filter(Boolean).length;

  const selectStyle = { width: 'auto', fontSize: '12px', padding: '6px 10px', minWidth: '120px' };

  return (
    <div className="page-container">
      {/* Top bar */}
      <div className="topbar">
        <div>
          <h1>Saved Leads</h1>
          <div className="topbar-subtitle">
            {dbTotalLeads.toLocaleString()} total in database
            {dbWithEmail > 0 && <span style={{ color: 'var(--success)', marginLeft: '8px' }}>· {dbWithEmail.toLocaleString()} with email</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {projects.length > 1 && (
            <select value={selectedProject} onChange={(e) => { setSelectedProject(e.target.value); setStateFilter([]); setCityFilter([]); }}
              className="input-field" style={{ width: 'auto', fontSize: '13px' }}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
            </select>
          )}
          <button onClick={handleExportCSV} disabled={totalLeads === 0 || isExporting} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '13px' }}>
            <Download className="w-4 h-4" /> {isExporting ? `Exporting ${totalLeads.toLocaleString()}...` : `Export CSV`}
          </button>
        </div>
      </div>

      {/* Apify Confirmation Dialog */}
      {showApifyConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="card" style={{ maxWidth: '440px', width: '90%', border: '1px solid rgba(255, 170, 0, 0.3)' }}>
            <div className="card-body" style={{ padding: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <Zap className="w-5 h-5" style={{ color: '#ffaa00' }} />
                <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>Enable Apify Deep Search?</h3>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 8px' }}>
                This will use <strong>Apify Google Maps</strong> to search for emails on leads where free strategies failed.
              </p>
              <div style={{ background: 'rgba(255,170,0,0.08)', border: '1px solid rgba(255,170,0,0.2)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '12px', color: '#ffaa00' }}>
                ⚡ This costs Apify compute units (~$0.01–0.03 per lead). Estimated cost for {enrichableCount} leads: ~${(enrichableCount * 0.02).toFixed(2)}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={() => setShowApifyConfirm(false)} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>Cancel</button>
                <button onClick={() => startEnrichment(true)} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '13px', background: 'linear-gradient(135deg, #ffaa00, #ff8800)' }}>
                  <Zap className="w-4 h-4" /> Confirm & Start
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Email Enrichment Bar */}
      {(enrichableCount > 0 || isEnriching || enrichDone) && (
        <div className="card" style={{ marginBottom: '20px', border: '1px solid rgba(124, 131, 219, 0.2)' }}>
          <div className="card-body" style={{ padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'linear-gradient(135deg, rgba(124, 131, 219, 0.15), rgba(124, 131, 219, 0.05))', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Mail className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>Email Enrichment</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {isEnriching ? (
                      <>
                        Multi-strategy scan... {enrichProgress.processed.toLocaleString()} of {enrichProgress.total.toLocaleString()} · <span style={{ color: 'var(--success)' }}>{enrichProgress.found} emails found</span>
                        {Object.keys(enrichSourceStats).length > 0 && (
                          <span style={{ marginLeft: '8px', opacity: 0.7 }}>
                            ({Object.entries(enrichSourceStats).map(([k, v]) => `${k}: ${v}`).join(', ')})
                          </span>
                        )}
                      </>
                    ) : enrichDone ? (
                      <>
                        <span style={{ color: 'var(--success)' }}>✓ Complete — {enrichDone.found} emails found</span>
                        <span> from {enrichDone.processed.toLocaleString()} leads scanned</span>
                        {Object.keys(enrichDone.sources).length > 0 && (
                          <span style={{ marginLeft: '6px', opacity: 0.7 }}>
                            ({Object.entries(enrichDone.sources).map(([k, v]) => `${k}: ${v}`).join(', ')})
                          </span>
                        )}
                        {enrichableCount > 0 && <span style={{ marginLeft: '6px' }}>· {enrichableCount.toLocaleString()} remaining</span>}
                      </>
                    ) : (
                      (() => {
                        const locationParts: string[] = [];
                        if (cityFilter.length > 0) locationParts.push(cityFilter.join(', '));
                        if (stateFilter.length > 0) locationParts.push(stateFilter.join(', '));
                        const loc = locationParts.length > 0 ? ` in ${locationParts.join(', ')}` : '';
                        return `${enrichableCount.toLocaleString()} leads${loc} — website + Google + social scan`;
                      })()
                    )}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isEnriching && (
                  <div style={{ width: '120px', height: '6px', borderRadius: '3px', background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                    <div style={{ width: `${enrichProgress.total > 0 ? (enrichProgress.processed / enrichProgress.total) * 100 : 0}%`, height: '100%', borderRadius: '3px', background: 'linear-gradient(90deg, var(--accent), var(--accent-light))', transition: 'width 0.3s ease' }} />
                  </div>
                )}
                {!isEnriching ? (
                  <>
                    <button type="button" onClick={(e) => { e.preventDefault(); handleResetEnrichment(); }} disabled={isResetting} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '12px', borderColor: 'rgba(255,255,255,0.1)', color: 'var(--text-muted)' }} title="Reset previously-attempted leads so they can be re-enriched">
                      <RotateCcw className={`w-3.5 h-3.5${isResetting ? ' animate-spin' : ''}`} /> {isResetting ? 'Resetting...' : 'Reset & Retry'}
                    </button>
                    <button onClick={() => handleEnrichEmails(false)} disabled={enrichableCount === 0} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '12px' }}>
                      <Shield className="w-3.5 h-3.5" /> Standard (Free)
                    </button>
                    <button onClick={() => handleEnrichEmails(true)} disabled={enrichableCount === 0} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '12px', borderColor: 'rgba(255,170,0,0.3)', color: '#ffaa00' }}>
                      <Zap className="w-3.5 h-3.5" /> Deep + Apify ($)
                    </button>
                  </>
                ) : (
                  <button onClick={() => { enrichAbortRef.current = true; }} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '12px', borderColor: 'rgba(255,107,107,0.3)' }}>Stop</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="card" style={{ marginBottom: '20px', overflow: 'visible' }}>
        <div className="card-body" style={{ padding: '14px 20px', overflow: 'visible' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <MapPin className="w-4 h-4" style={{ color: 'var(--accent)', flexShrink: 0 }} />

            {/* Industry filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Industry</span>
              <MultiSelectDropdown label="Industry" options={industries} selected={industryFilter} onChange={setIndustryFilter} allLabel={`All (${dbTotalLeads.toLocaleString()})`} />
            </div>

            {/* State filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>State</span>
              <MultiSelectDropdown label="State" options={states} selected={stateFilter} onChange={setStateFilter} allLabel="All States" />
            </div>

            {/* City filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>City</span>
              <MultiSelectDropdown label="City" options={cities} selected={cityFilter} onChange={setCityFilter}
                allLabel={`All Cities (${(stateFilter.length > 0
                  ? states.filter(s => stateFilter.includes(s.value)).reduce((sum, s) => sum + s.count, 0)
                  : dbTotalLeads
                ).toLocaleString()})`} />
            </div>

            <div style={{ width: '1px', height: '20px', background: 'var(--border)', flexShrink: 0 }} />

            {/* Email filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</span>
              <select value={emailFilter} onChange={(e) => setEmailFilter(e.target.value)} className="input-field" style={selectStyle}>
                <option value="">All</option>
                <option value="yes">Has Email</option>
                <option value="no">No Email</option>
              </select>
            </div>

            <div style={{ width: '1px', height: '20px', background: 'var(--border)', flexShrink: 0 }} />

            {/* Status filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-field" style={selectStyle}>
                <option value="">All</option>
                <option value="New">🔵 New</option>
                <option value="Contacted">🟡 Contacted</option>
                <option value="Signed Up">🟢 Signed Up</option>
              </select>
            </div>

            <div style={{ width: '1px', height: '20px', background: 'var(--border)', flexShrink: 0 }} />

            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: '1 1 180px', minWidth: '180px' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <Search className="w-3.5 h-3.5" style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Search business name..."
                  className="input-field" style={{ fontSize: '12px', padding: '6px 10px 6px 28px', width: '100%' }} />
              </div>
              {searchQuery && (
                <button onClick={() => { setSearchInput(''); setSearchQuery(''); }} style={{ padding: '4px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><X className="w-4 h-4" /></button>
              )}
            </div>

            {/* Clear all filters */}
            {activeFilterCount > 0 && (
              <button onClick={() => { setIndustryFilter([]); setStateFilter([]); setCityFilter([]); setStatusFilter(''); setEmailFilter(''); setSearchInput(''); setSearchQuery(''); }}
                style={{ fontSize: '11px', color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: '4px 8px' }}>
                Clear all ({activeFilterCount})
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results count + pagination */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', padding: '0 4px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{totalLeads.toLocaleString()}</span> results
          {emailCount > 0 && <span style={{ color: 'var(--success)', marginLeft: '8px' }}>· {emailCount} with email on this page</span>}
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}><ChevronLeft className="w-4 h-4" /></button>
            <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '100px', textAlign: 'center' }}>
              Page {page} of {totalPages.toLocaleString()}
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '12px' }}><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card">
        <div style={{ overflowX: 'auto', minHeight: '300px' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '250px', color: 'var(--text-muted)' }}>
              <Loader2 className="w-6 h-6 animate-spin mb-3" style={{ color: 'var(--accent)' }} />
              Loading from {currentProject?.name || 'database'}...
            </div>
          ) : leads.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '250px', color: 'var(--text-muted)' }}>
              <p>{totalLeads === 0 ? 'No leads match your filters.' : 'No leads found.'}</p>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Contact</th>
                  <th>Rating</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th style={{ width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="group">
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lead.business_name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{lead.industry}</div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        {lead.website && <a href={lead.website} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--accent-light)' }}>Website</a>}
                        {lead.google_maps_url && (
                          <a href={lead.google_maps_url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <ExternalLink className="w-2.5 h-2.5" /> Maps
                          </a>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ color: 'var(--text-secondary)' }}>{lead.phone || '–'}</div>
                      {lead.email ? (
                        <div style={{ color: 'var(--success)', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <Mail className="w-3 h-3" />{lead.email}
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>No email</div>
                      )}
                    </td>
                    <td>
                      {lead.rating ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Star className="w-3.5 h-3.5" style={{ color: '#ffaa00', fill: '#ffaa00' }} />
                          <span style={{ fontWeight: 600 }}>{lead.rating}</span>
                          {lead.review_count != null && <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>({lead.review_count})</span>}
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)' }}>–</span>}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      <div style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.address}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{lead.city}, {lead.state}</div>
                    </td>
                    <td>
                      <select value={lead.status} onChange={(e) => lead.id && handleStatusChange(lead.id, e.target.value)} disabled={updatingId === lead.id}
                        className="input-field" style={{ fontSize: '12px', padding: '4px 8px', width: 'auto', background: 'var(--bg-primary)' }}>
                        <option value="New">🔵 New</option>
                        <option value="Contacted">🟡 Contacted</option>
                        <option value="Signed Up">🟢 Signed Up</option>
                      </select>
                    </td>
                    <td>
                      <button onClick={() => lead.id && handleDelete(lead.id, lead.business_name)}
                        style={{ opacity: 0, padding: '4px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                        className="group-hover:!opacity-100 hover:!bg-[rgba(255,107,107,0.1)] hover:!text-[var(--danger)]"
                        title="Delete lead"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginTop: '16px', paddingBottom: '20px' }}>
          <button onClick={() => setPage(1)} disabled={page <= 1} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>First</button>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}><ChevronLeft className="w-4 h-4" /> Prev</button>
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)', padding: '0 12px' }}>
            Page <strong>{page}</strong> of {totalPages.toLocaleString()} · Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, totalLeads).toLocaleString()} of {totalLeads.toLocaleString()}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Next <ChevronRight className="w-4 h-4" /></button>
          <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }}>Last</button>
        </div>
      )}
    </div>
  );
}
