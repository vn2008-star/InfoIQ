'use client';

import { useState, useEffect } from 'react';

interface ProjectInfo { id: string; name: string; emoji: string; color: string; description: string; connected: boolean; }

export default function SettingsPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      if (d.projects) setProjects(d.projects);
    }).catch(() => {});
  }, []);

  return (
    <div className="page-container">
      <div className="topbar">
        <div>
          <h1>Settings</h1>
          <div className="topbar-subtitle">Configure your InfoIQ workspace</div>
        </div>
      </div>

      {/* Connected Projects */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <span style={{ fontSize: '15px', fontWeight: 600 }}>Connected Projects</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {projects.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '10px', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
              <span style={{ fontSize: '24px' }}>{p.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{p.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.description}</div>
              </div>
              <span className={`badge ${p.connected ? 'badge-success' : 'badge-danger'}`}>
                {p.connected ? 'Connected' : 'Not configured'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* API Keys info */}
      <div className="card">
        <div className="card-header">
          <span style={{ fontSize: '15px', fontWeight: 600 }}>API Configuration</span>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { name: 'Yelp API', env: 'YELP_API_KEY', desc: 'Free tier: 5,000 calls/day' },
            { name: 'Apify', env: 'APIFY_API_TOKEN', desc: 'Pay-per-use: ~$0.01/result' },
            { name: 'Google Places', env: 'GOOGLE_PLACES_API_KEY', desc: 'Pay-per-use: ~$0.003/call' },
          ].map(api => (
            <div key={api.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '10px', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{api.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{api.desc}</div>
              </div>
              <code style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '4px 8px', borderRadius: '6px' }}>
                {api.env}
              </code>
            </div>
          ))}
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
            Configure API keys in your <code style={{ background: 'var(--bg-elevated)', padding: '2px 6px', borderRadius: '4px' }}>.env.local</code> file.
          </div>
        </div>
      </div>
    </div>
  );
}
