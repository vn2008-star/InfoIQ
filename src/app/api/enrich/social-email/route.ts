import { NextResponse } from 'next/server';
import { extractEmails, pickBestEmail, fetchAndExtractEmails } from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// Social Profile Email Scraping
// Searches for Facebook/Instagram business pages and
// extracts emails from their public content.
// No API keys needed — pure HTML scraping.
// ════════════════════════════════════════════════════════

const SOCIAL_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Search Google for the business's Facebook page and scrape it for email.
 */
async function findEmailFromFacebook(
  businessName: string,
  city: string
): Promise<string | null> {
  try {
    // Step 1: Google for the Facebook page
    const query = `"${businessName}" "${city}" site:facebook.com`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=3`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(8000),
      headers: SOCIAL_FETCH_HEADERS,
      redirect: 'follow',
    });

    if (!searchRes.ok) return null;
    const searchHtml = await searchRes.text();

    // Extract Facebook URLs from search results
    const fbUrlRegex = /https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._\-]+/gi;
    const fbUrls = [...new Set(searchHtml.match(fbUrlRegex) || [])];

    if (fbUrls.length === 0) return null;

    // Step 2: Scrape the Facebook page for emails
    // Facebook often has email in the "About" section's HTML
    const allEmails: string[] = [];

    for (const fbUrl of fbUrls.slice(0, 2)) {
      // Try the main page and /about
      const urls = [fbUrl, `${fbUrl}/about`];
      for (const url of urls) {
        const emails = await fetchAndExtractEmails(url, 6000);
        allEmails.push(...emails);
        if (allEmails.length > 0) break;
      }
      if (allEmails.length > 0) break;
    }

    return pickBestEmail([...new Set(allEmails)]);
  } catch {
    return null;
  }
}

/**
 * Search Google for the business's Instagram page and scrape for email.
 * Many businesses list their email in their Instagram bio.
 */
async function findEmailFromInstagram(
  businessName: string,
  city: string
): Promise<string | null> {
  try {
    const query = `"${businessName}" "${city}" site:instagram.com`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=3`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(8000),
      headers: SOCIAL_FETCH_HEADERS,
      redirect: 'follow',
    });

    if (!searchRes.ok) return null;
    const searchHtml = await searchRes.text();

    // Extract emails from search result snippets (Instagram bios often show in Google snippets)
    const snippetEmails = extractEmails(searchHtml);
    if (snippetEmails.length > 0) {
      return pickBestEmail(snippetEmails);
    }

    // Try to scrape Instagram profile pages
    const igUrlRegex = /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]+/gi;
    const igUrls = [...new Set(searchHtml.match(igUrlRegex) || [])]
      .filter(url => !url.includes('/explore') && !url.includes('/p/') && !url.includes('/reel'));

    for (const igUrl of igUrls.slice(0, 2)) {
      const emails = await fetchAndExtractEmails(igUrl, 6000);
      if (emails.length > 0) {
        return pickBestEmail(emails);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Search Yelp listing page for embedded email (sometimes in reviews or business details).
 */
async function findEmailFromYelp(
  businessName: string,
  city: string
): Promise<string | null> {
  try {
    const query = `"${businessName}" "${city}" site:yelp.com`;
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=3`;

    const searchRes = await fetch(searchUrl, {
      signal: AbortSignal.timeout(8000),
      headers: SOCIAL_FETCH_HEADERS,
      redirect: 'follow',
    });

    if (!searchRes.ok) return null;
    const searchHtml = await searchRes.text();

    // Check Google snippets for email
    const emails = extractEmails(searchHtml);
    return pickBestEmail(emails);
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────
// POST /api/enrich/social-email
// ────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const { businessName, city, state } = await request.json();

    if (!businessName) {
      return NextResponse.json({ error: 'businessName required' }, { status: 400 });
    }

    const location = city || state || '';
    let email: string | null = null;
    let source = 'social_no_result';

    // Try Facebook first
    email = await findEmailFromFacebook(businessName, location);
    if (email) {
      return NextResponse.json({ email, source: 'facebook' });
    }

    // Try Instagram
    email = await findEmailFromInstagram(businessName, location);
    if (email) {
      return NextResponse.json({ email, source: 'instagram' });
    }

    // Try Yelp snippet scraping
    email = await findEmailFromYelp(businessName, location);
    if (email) {
      return NextResponse.json({ email, source: 'yelp_snippet' });
    }

    return NextResponse.json({ email: null, source });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Social email search failed';
    console.error('[Social Email]', msg);
    return NextResponse.json({ email: null, source: 'error', error: msg });
  }
}
