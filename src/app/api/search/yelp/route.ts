import { NextResponse } from 'next/server';
import { Lead } from '@/lib/types';

const MAX_YELP_PER_REQUEST = 50;
const MAX_YELP_TOTAL = 1000; // Yelp allows up to 1000 with offset

async function fetchYelpPage(apiKey: string, term: string, location: string, offset: number, limit: number) {
  const url = new URL('https://api.yelp.com/v3/businesses/search');
  url.searchParams.append('term', term);
  url.searchParams.append('location', location);
  url.searchParams.append('limit', String(limit));
  url.searchParams.append('offset', String(offset));
  url.searchParams.append('sort_by', 'best_match');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Yelp API Error (offset=${offset}):`, errorText);
    throw new Error(`Yelp API returned ${response.status}`);
  }

  return response.json();
}

export async function POST(request: Request) {
  try {
    const { industry, city, state, country, maxResults = 200 } = await request.json();

    const apiKey = process.env.YELP_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Yelp API key is not configured' }, { status: 500 });
    }

    const locationParts = [city, state, country].filter(Boolean);
    const locationQuery = locationParts.join(', ');
    const targetResults = Math.min(maxResults, MAX_YELP_TOTAL);

    const allBusinesses: any[] = [];
    let totalAvailable = Infinity;
    let offset = 0;
    let retries = 0;
    const maxRetries = 2;

    // Paginate through results
    while (allBusinesses.length < targetResults && offset < totalAvailable) {
      const limit = Math.min(MAX_YELP_PER_REQUEST, targetResults - allBusinesses.length);

      try {
        const data = await fetchYelpPage(apiKey, industry, locationQuery, offset, limit);

        if (data.total !== undefined) {
          totalAvailable = Math.min(data.total, MAX_YELP_TOTAL);
        }

        if (!data.businesses || data.businesses.length === 0) break;

        allBusinesses.push(...data.businesses);
        offset += data.businesses.length;
        retries = 0; // Reset retries on success
      } catch (err) {
        retries++;
        if (retries > maxRetries) {
          console.error('Max retries reached for Yelp pagination, returning what we have');
          break;
        }
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const leads: Lead[] = allBusinesses.map((business: any) => ({
      business_name: business.name,
      industry,
      address: business.location?.display_address?.join(', ') || 'Unknown',
      city: business.location?.city || city,
      state: business.location?.state || state,
      country,
      phone: business.display_phone || business.phone || null,
      email: null, // Yelp API does not provide email
      website: business.url || null,
      rating: business.rating || null,
      review_count: business.review_count || null,
      google_maps_url: null,
      source: 'Yelp',
      status: 'New' as const,
    }));

    return NextResponse.json({ leads, total: totalAvailable });
  } catch (error) {
    console.error('Yelp Search Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
