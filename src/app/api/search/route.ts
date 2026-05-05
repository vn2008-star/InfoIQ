import { NextResponse } from 'next/server';
import { Lead, SearchMode, SearchResponse } from '@/lib/types';

// Internal fetcher helper
async function fetchFromSource(
  baseUrl: string,
  source: string,
  body: any
): Promise<{ leads: Lead[]; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/search/${source}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      return { leads: [], error: data.error || `${source} returned ${res.status}` };
    }

    return { leads: data.leads || [] };
  } catch (err: any) {
    return { leads: [], error: err.message || `${source} fetch failed` };
  }
}

// Smart deduplication — matches on normalized business name + city
function deduplicateLeads(leads: Lead[]): Lead[] {
  const seen = new Map<string, Lead>();

  for (const lead of leads) {
    // Normalize: lowercase, trim, remove common suffixes
    const normalizedName = lead.business_name
      .toLowerCase()
      .trim()
      .replace(/[''`]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/(,?\s*(llc|inc|corp|ltd|salon|spa)\.?)$/i, '');

    const normalizedCity = (lead.city || '').toLowerCase().trim();
    const key = `${normalizedName}__${normalizedCity}`;

    if (seen.has(key)) {
      // Merge: keep the version with more data
      const existing = seen.get(key)!;
      seen.set(key, {
        ...existing,
        email: existing.email || lead.email,
        phone: existing.phone || lead.phone,
        website: existing.website || lead.website,
        rating: existing.rating || lead.rating,
        review_count: existing.review_count || lead.review_count,
        google_maps_url: existing.google_maps_url || lead.google_maps_url,
        // Keep the "better" source label
        source: existing.email ? existing.source :
          lead.email ? lead.source : existing.source,
      });
    } else {
      seen.set(key, lead);
    }
  }

  return Array.from(seen.values());
}

export async function POST(request: Request) {
  try {
    const { industry, city, state, country, mode = 'quick', maxResults = 200 } =
      await request.json();

    // Get the base URL for internal API calls
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const host = request.headers.get('host') || 'localhost:3000';
    const baseUrl = `${protocol}://${host}`;

    const body = { industry, city, state, country, maxResults };
    const allLeads: Lead[] = [];
    const sourceResults: SearchResponse['sources'] = [];

    // ─── MODE: quick (Yelp only — FREE) ───────────────────────
    if (mode === 'quick' || mode === 'deep') {
      const yelp = await fetchFromSource(baseUrl, 'yelp', body);
      sourceResults.push({
        name: 'Yelp',
        status: yelp.error ? 'error' : 'success',
        count: yelp.leads.length,
        error: yelp.error,
      });
      allLeads.push(...yelp.leads);
    }

    // ─── MODE: deep (Yelp + Apify Google Maps) ───────────────
    if (mode === 'deep') {
      const apify = await fetchFromSource(baseUrl, 'apify', body);
      sourceResults.push({
        name: 'Apify Google Maps',
        status: apify.error ? 'error' : 'success',
        count: apify.leads.length,
        error: apify.error,
      });
      allLeads.push(...apify.leads);

      // If Apify failed, fall back to Google Places API
      if (apify.error) {
        console.log('[Orchestrator] Apify failed, falling back to Google Places API');
        const google = await fetchFromSource(baseUrl, 'google', body);
        sourceResults.push({
          name: 'Google (fallback)',
          status: google.error ? 'error' : 'success',
          count: google.leads.length,
          error: google.error,
        });
        allLeads.push(...google.leads);
      }
    }

    // ─── MODE: fallback (Google Places only) ─────────────────
    if (mode === 'fallback') {
      const google = await fetchFromSource(baseUrl, 'google', body);
      sourceResults.push({
        name: 'Google',
        status: google.error ? 'error' : 'success',
        count: google.leads.length,
        error: google.error,
      });
      allLeads.push(...google.leads);
    }

    const totalBeforeDedup = allLeads.length;
    const dedupedLeads = deduplicateLeads(allLeads);

    const response: SearchResponse = {
      leads: dedupedLeads,
      sources: sourceResults,
      totalBeforeDedup,
    };

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Search Orchestrator Error:', error);
    return NextResponse.json(
      { error: error.message || 'Search failed' },
      { status: 500 }
    );
  }
}
