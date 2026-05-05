import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import { Lead } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const { industry, city, state, country, maxResults = 200 } = await request.json();

    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      return NextResponse.json({ error: 'Apify API token is not configured' }, { status: 500 });
    }

    const client = new ApifyClient({ token: apiToken });

    // Build the search query and location for Google Maps
    const locationParts = [city, state, country].filter(Boolean);
    const searchQuery = `${industry} in ${locationParts.join(', ')}`;

    // compass/crawler-google-places — the most powerful Google Maps scraper on Apify
    const input = {
      searchStringsArray: [searchQuery],
      maxCrawledPlacesPerSearch: Math.min(maxResults, 500),
      language: 'en',
      // Enable scraping of emails from business websites
      scrapeEmails: true,
      // Get additional data
      includeWebResults: false,
      // Geolocation is derived from the search string
      skipClosedPlaces: false,
    };

    console.log(`[Apify] Starting Google Maps scrape for: "${searchQuery}" (max ${maxResults})`);

    // Run the Actor and wait for it to finish
    // Timeout: 5 minutes max for reasonable-sized scrapes
    const run = await client.actor('compass/crawler-google-places').call(input, {
      waitSecs: 300,
    });

    if (!run || !run.defaultDatasetId) {
      throw new Error('Apify run failed — no dataset returned');
    }

    // Fetch results from the actor's dataset
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    console.log(`[Apify] Got ${items.length} results`);

    const leads: Lead[] = items.map((item: any) => {
      // Extract emails — the actor puts them in various fields
      const email = item.email ||
        item.emails?.[0] ||
        item.contactInfo?.email ||
        null;

      return {
        business_name: item.title || item.name || 'Unknown',
        industry,
        address: item.address || item.street || 'Unknown',
        city: item.city || city,
        state: item.state || state,
        country: item.countryCode || country,
        phone: item.phone || item.phoneUnformatted || null,
        email,
        website: item.website || item.url || null,
        rating: item.totalScore || item.rating || null,
        review_count: item.reviewsCount || item.reviews || null,
        google_maps_url: item.placeUrl || item.googleMapsUrl || null,
        source: 'Apify Google Maps',
        status: 'New' as const,
      };
    });

    return NextResponse.json({ leads });
  } catch (error: any) {
    console.error('Apify Google Maps Error:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Apify scrape failed' },
      { status: 500 }
    );
  }
}
