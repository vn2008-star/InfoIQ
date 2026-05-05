import { NextResponse } from 'next/server';
import { extractEmails, pickBestEmail, fetchAndExtractEmails } from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// Google Custom Search Email Discovery
// Searches Google for "business name" + "city" + email
// and scrapes top results for email addresses.
// ════════════════════════════════════════════════════════

/**
 * Strategy A: Use Google Custom Search JSON API
 * Requires GOOGLE_CSE_ID and GOOGLE_CSE_API_KEY in env.
 * Free tier: 100 queries/day.
 */
async function searchViaCSE(
  businessName: string,
  city: string
): Promise<{ email: string | null; source: string }> {
  const cseId = process.env.GOOGLE_CSE_ID;
  const apiKey = process.env.GOOGLE_CSE_API_KEY;

  if (!cseId || !apiKey) {
    return { email: null, source: 'google_cse_not_configured' };
  }

  const query = `"${businessName}" "${city}" email OR contact`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=5`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.warn(`[Google CSE] API error ${response.status}`);
      return { email: null, source: 'google_cse_error' };
    }

    const data = await response.json();
    const items = data.items || [];
    const allEmails: string[] = [];

    // 1. Extract emails from search snippets
    for (const item of items) {
      const snippet = (item.snippet || '') + ' ' + (item.title || '');
      const found = extractEmails(snippet);
      allEmails.push(...found);
    }

    // 2. If snippets didn't yield emails, scrape top 3 result pages
    if (allEmails.length === 0) {
      const pageUrls = items
        .slice(0, 3)
        .map((item: { link?: string }) => item.link)
        .filter((link: string | undefined): link is string =>
          !!link && !link.includes('yelp.com') && !link.includes('facebook.com')
        );

      const scrapeResults = await Promise.allSettled(
        pageUrls.map((pageUrl: string) => fetchAndExtractEmails(pageUrl, 6000))
      );

      for (const r of scrapeResults) {
        if (r.status === 'fulfilled') {
          allEmails.push(...r.value);
        }
      }
    }

    const unique = [...new Set(allEmails)];
    const best = pickBestEmail(unique);

    return { email: best, source: best ? 'google_cse' : 'google_cse_no_result' };
  } catch (error) {
    console.warn('[Google CSE] Search failed:', error);
    return { email: null, source: 'google_cse_error' };
  }
}

/**
 * Strategy B: Scrape Google search results directly (no API key needed).
 * This is a fallback when CSE is not configured.
 * Uses a simple fetch to get search results page.
 */
async function searchViaGoogleScrape(
  businessName: string,
  city: string
): Promise<{ email: string | null; source: string }> {
  const query = `"${businessName}" "${city}" email contact`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { email: null, source: 'google_scrape_blocked' };
    }

    const html = await response.text();
    const emails = extractEmails(html);
    const best = pickBestEmail(emails);

    return { email: best, source: best ? 'google_scrape' : 'google_scrape_no_result' };
  } catch {
    return { email: null, source: 'google_scrape_error' };
  }
}

// ────────────────────────────────────────────────────
// POST /api/enrich/google-email
// ────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { businessName, city, state } = await request.json();

    if (!businessName) {
      return NextResponse.json({ error: 'businessName required' }, { status: 400 });
    }

    const location = city || state || '';

    // Try CSE first (if configured), then fall back to scrape
    let result = await searchViaCSE(businessName, location);

    if (!result.email) {
      result = await searchViaGoogleScrape(businessName, location);
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Google email search failed';
    console.error('[Google Email]', msg);
    return NextResponse.json({ email: null, source: 'error', error: msg });
  }
}
