import { NextResponse } from 'next/server';
import { Lead } from '@/lib/types';

export async function POST(request: Request) {
  try {
    const { industry, city, state, country, maxResults = 60 } = await request.json();

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Google Places API key is not configured' }, { status: 500 });
    }

    // Construct the query
    const locationParts = [city, state, country].filter(Boolean);
    const textQuery = `${industry} in ${locationParts.join(', ')}`;

    // Google Places (New) API endpoint
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const allPlaces: any[] = [];
    let pageToken: string | undefined;
    const pagesNeeded = Math.ceil(Math.min(maxResults, 60) / 20);

    for (let page = 0; page < pagesNeeded; page++) {
      const body: any = {
        textQuery,
        languageCode: 'en',
        pageSize: 20,
      };

      if (pageToken) {
        body.pageToken = pageToken;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri,nextPageToken',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Google Places API Error:', errorText);
        if (page === 0) {
          throw new Error('Failed to fetch from Google Places API');
        }
        break; // Return what we have if subsequent pages fail
      }

      const data = await response.json();

      if (data.places) {
        allPlaces.push(...data.places);
      }

      pageToken = data.nextPageToken;
      if (!pageToken) break;

      // Google requires a short delay between paginated requests
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const leads: Lead[] = allPlaces.map((place: any) => ({
      business_name: place.displayName?.text || 'Unknown',
      industry,
      address: place.formattedAddress || 'Unknown',
      city,
      state,
      country,
      phone: place.nationalPhoneNumber || null,
      email: null, // Google Places API does not return email
      website: place.websiteUri || null,
      rating: place.rating || null,
      review_count: place.userRatingCount || null,
      google_maps_url: place.googleMapsUri || null,
      source: 'Google',
      status: 'New' as const,
    }));

    return NextResponse.json({ leads });
  } catch (error) {
    console.error('Google Places Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
