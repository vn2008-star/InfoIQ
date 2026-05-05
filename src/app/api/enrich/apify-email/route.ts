import { NextResponse } from 'next/server';
import { ApifyClient } from 'apify-client';
import { isValidBusinessEmail, pickBestEmail } from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// Apify — Google Maps Email Extractor
//
// Uses 'lukaskrivka/google-maps-with-contact-details'
// which automatically visits business websites and
// extracts emails, phone numbers, and social links.
//
// PAID — costs Apify compute units.
// ════════════════════════════════════════════════════════

interface LeadInput {
  id: string;
  business_name: string;
  city?: string;
  state?: string;
}

interface ApifyResult {
  id: string;
  email: string;
  source: string;
  website?: string;
}

export async function POST(request: Request) {
  try {
    const { leads, maxBatchSize = 20 } = await request.json();

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return NextResponse.json({ error: 'leads array required' }, { status: 400 });
    }

    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      return NextResponse.json({
        error: 'Apify API token not configured',
        results: [],
        total: leads.length,
        matched: 0,
      }, { status: 400 });
    }

    const client = new ApifyClient({ token: apiToken });
    const batch: LeadInput[] = leads.slice(0, maxBatchSize);

    // Build search queries
    const searchQueries = batch.map((lead: LeadInput) => {
      const parts = [lead.business_name, lead.city, lead.state].filter(Boolean);
      return parts.join(', ');
    });

    console.log(`[Apify] Searching ${searchQueries.length} leads via Google Maps (with contact details)`);

    const input = {
      searchStringsArray: searchQueries,
      maxCrawledPlacesPerSearch: 1,
      language: 'en',
      skipClosedPlaces: false,
      scrapeDirectories: false,
      // This actor visits the website and extracts contact info
    };

    // Run the actor that actually extracts emails
    const run = await client.actor('lukaskrivka/google-maps-with-contact-details').call(input, {
      waitSecs: 300,
    });

    if (!run || !run.defaultDatasetId) {
      console.error('[Apify] Actor run failed or no dataset');
      return NextResponse.json({
        results: [],
        total: batch.length,
        matched: 0,
        error: 'Apify run failed',
      });
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[Apify] Got ${items.length} results with contact details`);

    // Log sample to see available fields
    if (items.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sample = items[0] as any;
      const keys = Object.keys(sample);
      console.log(`[Apify] Sample keys: ${keys.join(', ')}`);
      // Log email/contact/website related fields
      for (const key of keys) {
        if (/email|contact|web|mail|site/i.test(key)) {
          console.log(`[Apify] Field "${key}":`, JSON.stringify(sample[key]));
        }
      }
    }

    // Match results to leads and extract emails
    const results: ApifyResult[] = [];

    for (const lead of batch) {
      const leadNameLower = lead.business_name.toLowerCase().trim();

      // Find matching result
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const match = items.find((item: any) => {
        const itemName = (item.title || item.name || item.searchString || '').toLowerCase().trim();
        return (
          itemName === leadNameLower ||
          itemName.includes(leadNameLower) ||
          leadNameLower.includes(itemName) ||
          levenshteinSimilarity(itemName, leadNameLower) > 0.7
        );
      });

      if (!match) {
        console.log(`[Apify] ✗ ${lead.business_name} — no match`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = match as any;

      // Extract emails from ALL possible fields
      const emailCandidates: string[] = [];

      // Direct email fields
      if (typeof m.email === 'string' && m.email) emailCandidates.push(m.email);
      if (typeof m.contactEmail === 'string' && m.contactEmail) emailCandidates.push(m.contactEmail);
      if (typeof m.websiteEmail === 'string' && m.websiteEmail) emailCandidates.push(m.websiteEmail);

      // Email arrays
      if (Array.isArray(m.emails)) emailCandidates.push(...m.emails.filter((e: unknown) => typeof e === 'string'));
      if (Array.isArray(m.scrapedEmails)) emailCandidates.push(...m.scrapedEmails.filter((e: unknown) => typeof e === 'string'));

      // Contact info objects
      if (m.contactInfo?.email) emailCandidates.push(m.contactInfo.email);
      if (Array.isArray(m.contactInfo?.emails)) emailCandidates.push(...m.contactInfo.emails);

      // Website contact details
      if (m.website?.contactDetails?.email) emailCandidates.push(m.website.contactDetails.email);
      if (Array.isArray(m.website?.contactDetails?.emails)) emailCandidates.push(...m.website.contactDetails.emails);

      // Regex fallback on full JSON if nothing found
      if (emailCandidates.length === 0) {
        const jsonStr = JSON.stringify(m);
        const regexEmails = jsonStr.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (regexEmails) emailCandidates.push(...regexEmails);
      }

      // Filter and pick best
      const validEmails = emailCandidates.filter(e => isValidBusinessEmail(e));
      const email = pickBestEmail(validEmails);

      if (email) {
        const website = m.website || m.webUrl || m.url || undefined;
        results.push({ id: lead.id, email, source: 'apify_google_maps', website });
        console.log(`[Apify] ✅ ${lead.business_name} → ${email}`);
      } else {
        console.log(`[Apify] ✗ ${lead.business_name} — matched, no email (${emailCandidates.length} candidates)`);
      }
    }

    console.log(`[Apify] Summary: ${items.length} results → ${results.length} emails found`);

    return NextResponse.json({
      results,
      total: batch.length,
      matched: results.length,
      apifyResults: items.length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Apify email enrichment failed';
    console.error('[Apify]', msg);
    return NextResponse.json({ error: msg, results: [], total: 0, matched: 0 }, { status: 500 });
  }
}

// ────────────────────────────────────────────────────
// Levenshtein similarity for fuzzy name matching
// ────────────────────────────────────────────────────

function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const costs: number[] = [];
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (shorter[i - 1] !== longer[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[longer.length] = lastValue;
  }

  return (longer.length - costs[longer.length]) / longer.length;
}
