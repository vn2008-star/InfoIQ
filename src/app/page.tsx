'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Lead, SearchMode, SearchResponse } from '@/lib/types';
import { Search, Download, Save, CheckCircle2, Loader2, Star, Mail, ExternalLink } from 'lucide-react';

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

interface ProjectInfo {
  id: string; name: string; emoji: string; color: string; description: string; connected: boolean;
}

export default function Home() {
  const [industry, setIndustry] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('US');
  const [mode, setMode] = useState<SearchMode>('quick');
  const [maxResults, setMaxResults] = useState(200);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [sourceInfo, setSourceInfo] = useState<SearchResponse['sources']>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // Email enrichment
  const [isEnriching, setIsEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0, found: 0 });
  const enrichAbortRef = useRef(false);

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('glowup');

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.projects) {
        const dbProjects = d.projects.filter((p: ProjectInfo) => p.id !== 'csv_only' && p.connected);
        setProjects(dbProjects);
        if (dbProjects.length > 0) setSelectedProject(dbProjects[0].id);
      }
    }).catch(() => {});
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLeads([]);
    setSourceInfo([]);
    setSaveSuccess(false);
    setSaveMessage('');

    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry, city, state, country, mode, maxResults }),
      });
      const data: SearchResponse = await res.json();
      setLeads(data.leads || []);
      setSourceInfo(data.sources || []);
    } catch {
      setSourceInfo([{ name: 'Error', status: 'error', count: 0, error: 'Search failed' }]);
    } finally {
      setLoading(false);
    }
  };

  const saveLeadsToProject = useCallback(async (leadsToSave: Lead[]) => {
    if (leadsToSave.length === 0 || selectedProject === 'csv_only') return;
    setSaving(true);
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leads: leadsToSave, projectId: selectedProject }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveSuccess(true);
        setSaveMessage(`${data.count} saved, ${data.duplicates} dupes skipped`);
      }
    } catch {
      setSaveMessage('Save failed');
    } finally {
      setSaving(false);
    }
  }, [selectedProject]);

  const handleDownloadCSV = () => {
    if (leads.length === 0) return;
    const headers = ['Business Name', 'Industry', 'Address', 'City', 'State', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'Google Maps URL', 'Source'];
    const rows = leads.map(l => [
      `"${(l.business_name || '').replace(/"/g, '""')}"`, `"${l.industry || ''}"`, `"${(l.address || '').replace(/"/g, '""')}"`,
      `"${l.city || ''}"`, `"${l.state || ''}"`, `"${l.phone || ''}"`, `"${l.email || ''}"`, `"${l.website || ''}"`,
      `"${l.rating || ''}"`, `"${l.review_count || ''}"`, `"${l.google_maps_url || ''}"`, `"${l.source || ''}"`
    ].join(','));
    const blob = new Blob(['\uFEFF' + [headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `infoiq_${industry.replace(/\s+/g, '_')}_${city || 'all'}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleEnrichEmails = async () => {
    const leadsToEnrich = leads.filter(l => l.website && !l.email);
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
          setLeads(prev => {
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
  };

  const emailCount = leads.filter(l => l.email).length;
  const enrichableCount = leads.filter(l => l.website && !l.email).length;
  const currentProject = projects.find(p => p.id === selectedProject);

  return (
    <div className="page-container">
      {/* Top bar */}
      <div className="topbar">
        <div>
          <h1>Search Leads</h1>
          <div className="topbar-subtitle">Find businesses by industry and location</div>
        </div>
        {projects.length > 1 && (
          <select
            value={selectedProject}
            onChange={(e) => { setSelectedProject(e.target.value); setSaveSuccess(false); }}
            className="input-field"
            style={{ width: 'auto', fontSize: '13px' }}
          >
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Search Form */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-body">
          <form onSubmit={handleSearch}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '20px' }}>
              <div className="input-group">
                <label className="input-label">Industry</label>
                <input required value={industry} onChange={(e) => setIndustry(e.target.value)} type="text" placeholder="Type or select..." className="input-field" list="industry-list" />
                <datalist id="industry-list">
                  {POPULAR_INDUSTRIES.map(i => <option key={i} value={i} />)}
                </datalist>
              </div>
              <div className="input-group">
                <label className="input-label">City</label>
                <input required value={city} onChange={(e) => setCity(e.target.value)} type="text" placeholder="e.g., Los Angeles" className="input-field" />
              </div>
              <div className="input-group">
                <label className="input-label">State</label>
                <input value={state} onChange={(e) => setState(e.target.value)} type="text" placeholder="e.g., CA" className="input-field" />
              </div>
              <div className="input-group">
                <label className="input-label">Country</label>
                <input value={country} onChange={(e) => setCountry(e.target.value)} type="text" placeholder="US" className="input-field" />
              </div>
            </div>

            {/* Mode + Max Results Row */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
              <div className="input-group">
                <label className="input-label">Mode</label>
                <div className="mode-toggle">
                  <button type="button" onClick={() => setMode('quick')} className={mode === 'quick' ? 'active' : ''}>
                    Yelp <span style={{ fontSize: '10px', opacity: 0.7 }}>FREE</span>
                  </button>
                  <button type="button" onClick={() => setMode('deep')} className={mode === 'deep' ? 'active' : ''}>
                    Deep <span style={{ fontSize: '10px', opacity: 0.7 }}>+EMAIL</span>
                  </button>
                  <button type="button" onClick={() => setMode('fallback')} className={mode === 'fallback' ? 'active' : ''}>
                    Google
                  </button>
                </div>
              </div>

              <div className="input-group" style={{ minWidth: '140px' }}>
                <label className="input-label">Max Results: {maxResults}</label>
                <input type="range" min={20} max={mode === 'fallback' ? 60 : 1000} step={10}
                  value={Math.min(maxResults, mode === 'fallback' ? 60 : 1000)}
                  onChange={(e) => setMaxResults(Number(e.target.value))}
                  style={{ accentColor: 'var(--accent)', height: '6px', width: '100%', marginTop: '4px' }}
                />
              </div>

              <div style={{ marginLeft: 'auto' }}>
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {loading ? 'Searching...' : 'Find Leads'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Source Status */}
      {sourceInfo.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {sourceInfo.map((s, i) => (
            <span key={i} className={`badge ${s.status === 'success' ? 'badge-success' : s.status === 'error' ? 'badge-danger' : 'badge-accent'}`}>
              {s.status === 'success' ? '✓' : s.status === 'error' ? '✕' : '–'} {s.name}: {s.count}
              {s.error && <span style={{ opacity: 0.7, marginLeft: '4px' }}>({s.error})</span>}
            </span>
          ))}
        </div>
      )}

      {/* Results */}
      {(leads.length > 0 || loading) && (
        <div className="card">
          <div className="card-header">
            <div>
              <span style={{ fontSize: '15px', fontWeight: 600 }}>
                {loading ? 'Searching...' : `${leads.length} businesses found`}
              </span>
              <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                {emailCount > 0 && (
                  <span className="badge badge-success"><Mail className="w-3 h-3" /> {emailCount} with email</span>
                )}
              </div>
            </div>

            {!loading && leads.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {!isEnriching ? (
                  <button onClick={handleEnrichEmails} disabled={enrichableCount === 0} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                    <Mail className="w-4 h-4" /> {enrichableCount > 0 ? `Enrich Emails (${enrichableCount})` : 'All enriched'}
                  </button>
                ) : (
                  <button onClick={() => { enrichAbortRef.current = true; }} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {enrichProgress.done}/{enrichProgress.total} ({enrichProgress.found} found) — Stop
                  </button>
                )}
                <button onClick={handleDownloadCSV} className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '13px' }}>
                  <Download className="w-4 h-4" /> CSV
                </button>
                {selectedProject !== 'csv_only' && (
                  <button
                    onClick={() => saveLeadsToProject(leads)}
                    disabled={saving || saveSuccess}
                    className={`btn ${saveSuccess ? 'btn-secondary' : 'btn-primary'}`}
                    style={{ padding: '8px 16px', fontSize: '13px' }}
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saveSuccess ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                    {saving ? 'Saving...' : saveSuccess ? (saveMessage || 'Saved!') : `Save to ${currentProject?.name || 'DB'}`}
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Contact</th>
                  <th>Rating</th>
                  <th>Location</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)' }}>
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-3" style={{ color: 'var(--accent)' }} />
                      {mode === 'deep' ? 'Deep scraping with Apify... this may take 1-3 minutes' : 'Searching for leads...'}
                    </td>
                  </tr>
                ) : leads.map((lead, i) => (
                  <tr key={i}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{lead.business_name}</div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                        {lead.website && <a href={lead.website} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--accent-light)' }}>Website</a>}
                        {lead.google_maps_url && (
                          <a href={lead.google_maps_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                            <ExternalLink className="w-3 h-3" /> Maps
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
                        <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>No email</div>
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
                    <td style={{ color: 'var(--text-secondary)', maxWidth: '200px' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lead.address}</div>
                    </td>
                    <td>
                      <span className={`badge ${lead.source === 'Yelp' ? 'badge-danger' : lead.source === 'Apify Google Maps' ? 'badge-accent' : 'badge-success'}`}>
                        {lead.source}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
