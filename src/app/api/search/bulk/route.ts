import { NextResponse } from 'next/server';
import { Lead } from '@/lib/types';
import { ApifyClient } from 'apify-client';
import { DRILL_CITIES } from '@/lib/us-cities';

const MAX_YELP_PER_REQUEST = 50;
const MAX_YELP_TOTAL = 1000;
const YELP_CAP_THRESHOLD = 950; // If we get close to 1000, consider it capped

/**
 * Bulk search — handles ONE state at a time.
 * Smart Hybrid: if state-level hits the 1,000 cap, auto-drills into cities.
 */
export async function POST(request: Request) {
  try {
    const { industry, stateCode, stateName, country = 'US', mode = 'yelp', maxPerState = 1000 } = await request.json();

    if (!industry || !stateCode) {
      return NextResponse.json({ error: 'Missing industry or stateCode' }, { status: 400 });
    }

    if (mode === 'apify') {
      return await searchApify(industry, stateCode, stateName, country, maxPerState);
    }

    return await searchYelpHybrid(industry, stateCode, stateName, country, maxPerState);
  } catch (error: any) {
    console.error('Bulk Search Error:', error);
    return NextResponse.json({ error: error.message || 'Search failed' }, { status: 500 });
  }
}

/**
 * Smart Hybrid Yelp Search:
 * 1. Search at state level (up to 1,000)
 * 2. If capped → automatically drill into top cities for that state
 * 3. Deduplicate by business_name + city
 */
async function searchYelpHybrid(industry: string, stateCode: string, stateName: string, country: string, maxResults: number) {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Yelp API key not configured' }, { status: 500 });
  }

  // Step 1: State-level search
  console.log(`[Bulk Yelp] Searching state: ${stateName} (${stateCode})`);
  const stateResult = await fetchYelpPaginated(apiKey, industry, `${stateName}, ${country}`, maxResults);

  // If the API completely failed (0 leads, no real total), return early with error info
  if (stateResult.leads.length === 0 && !stateResult.gotData) {
    console.log(`[Bulk Yelp] ${stateCode}: API failed (error: ${stateResult.error || 'unknown'})`);
    return NextResponse.json({
      leads: [],
      stateCode,
      stateName,
      totalAvailable: 0,
      drilled: false,
      error: stateResult.error || 'Yelp API returned no data',
    });
  }

  // Only consider capped if we actually received leads near the threshold
  const isCapped = stateResult.gotData && stateResult.leads.length >= YELP_CAP_THRESHOLD;
  let allLeads = [...stateResult.leads];
  let drilled = false;
  const drilledCities: string[] = [];

  // Step 2: If capped, drill into cities
  if (isCapped) {
    const cities = DRILL_CITIES[stateCode] || [];
    if (cities.length > 0) {
      drilled = true;
      console.log(`[Bulk Yelp] ${stateCode} hit cap (${stateResult.leads.length}/${stateResult.totalAvailable}). Drilling into ${cities.length} cities...`);

      for (const city of cities) {
        try {
          const cityResult = await fetchYelpPaginated(apiKey, industry, `${city}, ${stateCode}, ${country}`, 1000);
          if (cityResult.leads.length > 0) {
            allLeads.push(...cityResult.leads);
            drilledCities.push(`${city} (${cityResult.leads.length})`);
          }
          // Delay between city searches to respect rate limits
          await new Promise(r => setTimeout(r, 800 + Math.random() * 400));
        } catch (err) {
          console.error(`[Bulk Yelp] City drill failed for ${city}, ${stateCode}:`, err);
        }
      }
    }
  }

  // Step 3: Deduplicate by business_name + city
  const seen = new Set<string>();
  const uniqueLeads: Lead[] = [];
  for (const lead of allLeads) {
    const key = `${lead.business_name}::${lead.city}`.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueLeads.push(lead);
    }
  }

  console.log(`[Bulk Yelp] ${stateCode}: ${stateResult.leads.length} state-level → ${allLeads.length} total → ${uniqueLeads.length} unique${drilled ? ` (drilled ${drilledCities.length} cities)` : ''}`);

  return NextResponse.json({
    leads: uniqueLeads,
    stateCode,
    stateName,
    totalAvailable: stateResult.totalAvailable,
    drilled,
    drilledCities,
    rawTotal: allLeads.length,
  });
}

/**
 * Paginated Yelp search for a single location query.
 */
async function fetchYelpPaginated(apiKey: string, industry: string, location: string, maxResults: number) {
  const target = Math.min(maxResults, MAX_YELP_TOTAL);
  const allBusinesses: any[] = [];
  let totalAvailable = 0;
  let offset = 0;
  let retries = 0;
  let gotData = false;
  let lastError: string | null = null;
  const MAX_RETRIES = 5;

  let firstRequest = true;
  while (allBusinesses.length < target && (firstRequest || offset < totalAvailable)) {
    firstRequest = false;
    const limit = Math.min(MAX_YELP_PER_REQUEST, target - allBusinesses.length);

    try {
      const url = new URL('https://api.yelp.com/v3/businesses/search');
      url.searchParams.append('term', industry);
      url.searchParams.append('location', location);
      url.searchParams.append('limit', String(limit));
      url.searchParams.append('offset', String(offset));
      url.searchParams.append('sort_by', 'best_match');

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      });

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        // Handle both 429 (standard) and 420 (Yelp custom) rate limits
        if (response.status === 429 || response.status === 420) {
          lastError = `Rate limited (${response.status})`;
          retries++;
          if (retries > MAX_RETRIES) {
            console.warn(`[Yelp] Rate limit exhausted after ${MAX_RETRIES} retries for: ${location}`);
            break;
          }
          // Exponential backoff: 5s, 10s, 20s, 40s, 80s + jitter
          const backoffMs = Math.min(5000 * Math.pow(2, retries - 1), 80000) + Math.random() * 2000;
          console.log(`[Yelp] Rate limited (${response.status}). Retry ${retries}/${MAX_RETRIES} in ${(backoffMs / 1000).toFixed(1)}s for: ${location}`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        if (response.status === 401) {
          lastError = 'Invalid API key (401)';
        }
        break;
      }

      const data = await response.json();
      gotData = true;
      if (data.total !== undefined) {
        totalAvailable = Math.min(data.total, MAX_YELP_TOTAL);
      }
      if (!data.businesses || data.businesses.length === 0) break;

      allBusinesses.push(...data.businesses);
      offset += data.businesses.length;
      retries = 0;

      if (allBusinesses.length < target) {
        // Respectful delay between pages: 500ms + jitter
        await new Promise(r => setTimeout(r, 500 + Math.random() * 300));
      }
    } catch {
      retries++;
      if (retries > MAX_RETRIES) break;
      await new Promise(r => setTimeout(r, 2000 * retries));
    }
  }

  const leads: Lead[] = allBusinesses.map((b: any) => ({
    business_name: b.name,
    industry,
    address: b.location?.display_address?.join(', ') || 'Unknown',
    city: b.location?.city || '',
    state: b.location?.state || '',
    country: 'US',
    phone: b.display_phone || b.phone || null,
    email: null,
    website: b.url || null,
    rating: b.rating || null,
    review_count: b.review_count || null,
    google_maps_url: null,
    source: 'Yelp',
    status: 'New' as const,
  }));

  return { leads, totalAvailable, gotData, error: lastError };
}

/**
 * Apify search (unchanged — searches at state level).
 */
async function searchApify(industry: string, stateCode: string, stateName: string, country: string, maxResults: number) {
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken || apiToken === 'your_apify_api_token_here') {
    return NextResponse.json({ error: 'Apify API token not configured' }, { status: 500 });
  }

  const client = new ApifyClient({ token: apiToken });
  const searchQuery = `${industry} in ${stateName}, ${country}`;

  console.log(`[Apify Bulk] Scraping: "${searchQuery}" (max ${maxResults})`);

  const run = await client.actor('compass/crawler-google-places').call(
    {
      searchStringsArray: [searchQuery],
      maxCrawledPlacesPerSearch: Math.min(maxResults, 500),
      language: 'en',
      scrapeEmails: true,
      includeWebResults: false,
      skipClosedPlaces: false,
    },
    { waitSecs: 600 }
  );

  if (!run?.defaultDatasetId) {
    return NextResponse.json({ error: 'Apify run failed' }, { status: 500 });
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();

  const leads: Lead[] = items.map((item: any) => ({
    business_name: item.title || item.name || 'Unknown',
    industry,
    address: item.address || item.street || 'Unknown',
    city: item.city || '',
    state: item.state || stateCode,
    country: item.countryCode || country,
    phone: item.phone || item.phoneUnformatted || null,
    email: item.email || item.emails?.[0] || item.contactInfo?.email || null,
    website: item.website || item.url || null,
    rating: item.totalScore || item.rating || null,
    review_count: item.reviewsCount || item.reviews || null,
    google_maps_url: item.placeUrl || item.googleMapsUrl || null,
    source: 'Apify Google Maps',
    status: 'New' as const,
  }));

  return NextResponse.json({
    leads,
    stateCode,
    stateName,
    totalAvailable: leads.length,
    drilled: false,
  });
}
