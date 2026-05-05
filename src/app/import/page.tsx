'use client';

import { useState, useCallback, useRef } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, ArrowRight, X, RefreshCw } from 'lucide-react';

// ════════════════════════════════════════════════════════
// CSV Import Page
// Upload Apify CSV exports or any CSV to enrich existing leads
// ════════════════════════════════════════════════════════

interface CsvRow {
  [key: string]: string;
}

interface ColumnMapping {
  business_name: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  state: string;
  address: string;
  rating: string;
  review_count: string;
}

interface ImportResult {
  total: number;
  matched: number;
  emailsUpdated: number;
  websitesUpdated: number;
  phonesUpdated: number;
  newLeadsInserted: number;
  skippedInvalidEmail: number;
  notFound: number;
  errors: string[];
}

// Common Apify column name mappings
const APIFY_COLUMN_ALIASES: Record<string, string[]> = {
  business_name: ['title', 'name', 'business_name', 'businessname', 'company', 'place'],
  email: ['email', 'emails', 'contactemail', 'websiteemail', 'contact_email'],
  phone: ['phone', 'phones', 'phoneunformatted', 'phone_number', 'telephone'],
  website: ['website', 'weburl', 'web', 'site', 'homepage', 'url'],
  city: ['city', 'locality'],
  state: ['state', 'region', 'province'],
  address: ['address', 'street', 'fulladdress', 'full_address', 'location'],
  rating: ['rating', 'totalscore', 'total_score', 'stars'],
  review_count: ['review_count', 'reviewscount', 'reviews_count', 'reviews', 'reviewcount'],
};

function autoMapColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    business_name: '',
    email: '',
    phone: '',
    website: '',
    city: '',
    state: '',
    address: '',
    rating: '',
    review_count: '',
  };

  for (const [field, aliases] of Object.entries(APIFY_COLUMN_ALIASES)) {
    for (const header of headers) {
      const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (aliases.some(a => a.replace(/[^a-z0-9]/g, '') === h)) {
        mapping[field as keyof ColumnMapping] = header;
        break;
      }
    }
  }

  return mapping;
}

function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse rows
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export default function ImportPage() {
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'importing' | 'done'>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    business_name: '', email: '', phone: '', website: '', city: '', state: '', address: '', rating: '', review_count: '',
  });
  const [mode, setMode] = useState<'update' | 'upsert'>('update');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setError('');
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCSV(text);

      if (h.length === 0 || r.length === 0) {
        setError('Could not parse CSV file. Make sure it has headers and data rows.');
        return;
      }

      setHeaders(h);
      setRows(r);

      // Auto-map columns
      const autoMap = autoMapColumns(h);
      setMapping(autoMap);
      setStep('map');
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleFile(file);
    } else {
      setError('Please upload a CSV file');
    }
  }, [handleFile]);

  const handleImport = async () => {
    if (!mapping.business_name) {
      setError('Business Name column mapping is required');
      return;
    }

    setStep('importing');
    setError('');

    // Transform rows using mapping
    const mappedRows = rows.map(row => {
      const mapped: Record<string, unknown> = {};
      for (const [field, col] of Object.entries(mapping)) {
        if (col && row[col] !== undefined) {
          // Handle email arrays from Apify (e.g., "email1,email2" or "[email1,email2]")
          if (field === 'email') {
            let emailVal = row[col].replace(/[\[\]"]/g, '').trim();
            // Take first email if multiple
            if (emailVal.includes(',')) {
              emailVal = emailVal.split(',')[0].trim();
            }
            mapped[field] = emailVal || undefined;
          } else if (field === 'rating' || field === 'review_count') {
            const num = parseFloat(row[col]);
            mapped[field] = isNaN(num) ? undefined : num;
          } else {
            mapped[field] = row[col].trim() || undefined;
          }
        }
      }
      return mapped;
    }).filter(r => r.business_name);

    try {
      const res = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: mappedRows, projectId: 'glowup', mode }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Import failed');
        setStep('preview');
        return;
      }

      setResult(data);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
      setStep('preview');
    }
  };

  // Count rows with email data
  const rowsWithEmail = rows.filter(r => {
    const col = mapping.email;
    if (!col) return false;
    const val = r[col]?.replace(/[\[\]"]/g, '').trim();
    return val && val.length > 0;
  }).length;

  return (
    <div style={{ padding: '32px 40px', maxWidth: '900px' }}>
      <h1 style={{ fontSize: '28px', fontWeight: 700, marginBottom: '4px' }}>Import CSV</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '28px', fontSize: '14px' }}>
        Upload Apify exports or any CSV to enrich existing leads with emails, phones, and websites.
      </p>

      {error && (
        <div style={{
          padding: '12px 16px',
          borderRadius: '10px',
          background: 'rgba(255,80,80,0.1)',
          border: '1px solid rgba(255,80,80,0.3)',
          color: '#ff6b6b',
          marginBottom: '20px',
          fontSize: '13px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── Step 1: Upload ── */}
      {step === 'upload' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: '16px',
            padding: '60px 40px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s',
            background: isDragging ? 'rgba(139,92,246,0.05)' : 'var(--card-bg)',
          }}
        >
          <Upload size={40} style={{ color: 'var(--accent)', marginBottom: '16px' }} />
          <p style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>
            Drop your CSV file here or click to browse
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
            Supports Apify Google Maps exports, or any CSV with business names + emails
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
        </div>
      )}

      {/* ── Step 2: Column Mapping ── */}
      {step === 'map' && (
        <div>
          <div style={{
            background: 'var(--card-bg)',
            borderRadius: '14px',
            border: '1px solid var(--border)',
            padding: '24px',
            marginBottom: '20px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <FileSpreadsheet size={20} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 600 }}>{fileName}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                · {rows.length} rows · {headers.length} columns
              </span>
              <button
                type="button"
                onClick={() => { setStep('upload'); setRows([]); setHeaders([]); }}
                style={{
                  marginLeft: 'auto',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <X size={16} />
              </button>
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              Map your CSV columns to lead fields. We auto-detected Apify column names.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {(Object.keys(mapping) as (keyof ColumnMapping)[]).map((field) => (
                <div key={field}>
                  <label style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: field === 'business_name' ? 'var(--accent)' : 'var(--text-secondary)',
                    display: 'block',
                    marginBottom: '4px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {field.replace(/_/g, ' ')} {field === 'business_name' ? '(required)' : ''}
                  </label>
                  <select
                    value={mapping[field]}
                    onChange={(e) => setMapping(prev => ({ ...prev, [field]: e.target.value }))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: `1px solid ${mapping[field] ? 'var(--accent)' : 'var(--border)'}`,
                      background: 'var(--bg)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                    }}
                  >
                    <option value="">— Skip —</option>
                    {headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Import mode */}
          <div style={{
            background: 'var(--card-bg)',
            borderRadius: '14px',
            border: '1px solid var(--border)',
            padding: '20px 24px',
            marginBottom: '20px',
          }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Import Mode
            </label>
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                type="button"
                onClick={() => setMode('update')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: `1px solid ${mode === 'update' ? 'var(--accent)' : 'var(--border)'}`,
                  background: mode === 'update' ? 'rgba(139,92,246,0.1)' : 'var(--bg)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '13px',
                }}
              >
                <strong>Update Only</strong>
                <br />
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  Only update existing leads (match by name + city)
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode('upsert')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  borderRadius: '10px',
                  border: `1px solid ${mode === 'upsert' ? 'var(--accent)' : 'var(--border)'}`,
                  background: mode === 'upsert' ? 'rgba(139,92,246,0.1)' : 'var(--bg)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: '13px',
                }}
              >
                <strong>Update + Insert New</strong>
                <br />
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                  Update existing + add unmatched as new leads
                </span>
              </button>
            </div>
          </div>

          {/* Preview stats */}
          <div style={{
            background: 'var(--card-bg)',
            borderRadius: '14px',
            border: '1px solid var(--border)',
            padding: '16px 24px',
            marginBottom: '20px',
            display: 'flex',
            gap: '24px',
          }}>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 700 }}>{rows.length}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Total rows</div>
            </div>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--accent)' }}>{rowsWithEmail}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>With email</div>
            </div>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 700 }}>{rows.length - rowsWithEmail}</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No email</div>
            </div>
          </div>

          {/* Preview table */}
          <div style={{
            background: 'var(--card-bg)',
            borderRadius: '14px',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            marginBottom: '20px',
          }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: '13px', fontWeight: 600 }}>
              Preview (first 5 rows)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {Object.entries(mapping).filter(([, col]) => col).map(([field]) => (
                      <th key={field} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', textTransform: 'uppercase', fontSize: '11px', fontWeight: 600 }}>
                        {field.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {Object.entries(mapping).filter(([, col]) => col).map(([field, col]) => (
                        <td key={field} style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid var(--border)',
                          maxWidth: '200px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: field === 'email' && row[col] ? '#10b981' : 'var(--text-primary)',
                        }}>
                          {row[col] || '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            onClick={handleImport}
            disabled={!mapping.business_name}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              border: 'none',
              background: 'var(--accent)',
              color: 'white',
              fontSize: '15px',
              fontWeight: 600,
              cursor: mapping.business_name ? 'pointer' : 'not-allowed',
              opacity: mapping.business_name ? 1 : 0.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <ArrowRight size={18} />
            Import {rows.length} rows ({mode === 'update' ? 'Update Only' : 'Update + Insert'})
          </button>
        </div>
      )}

      {/* ── Step 3: Importing ── */}
      {step === 'importing' && (
        <div style={{
          textAlign: 'center',
          padding: '60px 40px',
          background: 'var(--card-bg)',
          borderRadius: '16px',
          border: '1px solid var(--border)',
        }}>
          <RefreshCw size={40} style={{ color: 'var(--accent)', marginBottom: '16px', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: '16px', fontWeight: 600 }}>Importing {rows.length} rows...</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Matching against existing leads by business name + city</p>
        </div>
      )}

      {/* ── Step 4: Results ── */}
      {step === 'done' && result && (
        <div>
          <div style={{
            background: 'var(--card-bg)',
            borderRadius: '16px',
            border: '1px solid var(--border)',
            padding: '32px',
            textAlign: 'center',
            marginBottom: '20px',
          }}>
            <CheckCircle size={48} style={{ color: '#10b981', marginBottom: '16px' }} />
            <h2 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px' }}>Import Complete</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Processed {result.total} rows from {fileName}
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '12px',
            marginBottom: '20px',
          }}>
            {[
              { label: 'Matched', value: result.matched, color: 'var(--text-primary)' },
              { label: 'Emails Added', value: result.emailsUpdated, color: '#10b981' },
              { label: 'Websites Added', value: result.websitesUpdated, color: '#3b82f6' },
              { label: 'New Leads', value: result.newLeadsInserted, color: 'var(--accent)' },
            ].map((stat) => (
              <div key={stat.label} style={{
                background: 'var(--card-bg)',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                padding: '16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '28px', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {(result.notFound > 0 || result.skippedInvalidEmail > 0) && (
            <div style={{
              background: 'var(--card-bg)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              padding: '16px 20px',
              marginBottom: '20px',
              fontSize: '13px',
              color: 'var(--text-secondary)',
            }}>
              {result.notFound > 0 && <p>· {result.notFound} rows had no matching lead in database</p>}
              {result.skippedInvalidEmail > 0 && <p>· {result.skippedInvalidEmail} emails skipped (invalid/junk)</p>}
            </div>
          )}

          {result.errors.length > 0 && (
            <div style={{
              background: 'rgba(255,80,80,0.05)',
              borderRadius: '12px',
              border: '1px solid rgba(255,80,80,0.2)',
              padding: '16px 20px',
              marginBottom: '20px',
              fontSize: '12px',
              color: '#ff6b6b',
            }}>
              {result.errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}

          <button
            type="button"
            onClick={() => { setStep('upload'); setRows([]); setHeaders([]); setResult(null); }}
            style={{
              padding: '12px 24px',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              background: 'var(--card-bg)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Import Another File
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
