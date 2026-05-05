import { NextResponse } from 'next/server';
import {
  extractEmails,
  pickBestEmail,
  isYelpListingUrl,
  resolveWebsiteByGuessing,
  scrapeEmailFromWebsite,
  resolveWebsiteUrl,
} from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// POST /api/enrich — In-memory enrichment (Search page)
// Accepts a batch of leads with website URLs, resolves
// real websites, and scrapes each for emails.
// Uses shared utilities from @/lib/email-utils.
// ════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { leads, batchSize = 5 } = await request.json();

    if (!leads || !Array.isArray(leads)) {
      return NextResponse.json({ error: 'leads array required' }, { status: 400 });
    }

    const results: Array<{
      index: number;
      email: string | null;
      allEmails: string[];
      website: string;
      resolvedWebsite: string | null;
      business_name: string;
    }> = [];

    // Process in batches to avoid overwhelming
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        batch.map(async (lead: any, batchIdx: number) => {
          const idx = i + batchIdx;

          // Skip if no website or already has email
          if (!lead.website || lead.email) {
            return {
              index: idx,
              email: lead.email || null,
              allEmails: [],
              website: lead.website || '',
              resolvedWebsite: null,
              business_name: lead.business_name,
            };
          }

          // Resolve the real website URL (handles Yelp URLs)
          const resolved = await resolveWebsiteUrl(lead.website, lead.business_name, lead.city);

          if (!resolved) {
            return {
              index: idx,
              email: null,
              allEmails: [],
              website: lead.website,
              resolvedWebsite: null,
              business_name: lead.business_name,
            };
          }

          let websiteUrl = resolved;
          if (!websiteUrl.startsWith('http')) {
            websiteUrl = 'https://' + websiteUrl;
          }

          const { email, allEmails } = await scrapeEmailFromWebsite(websiteUrl);
          return {
            index: idx,
            email,
            allEmails,
            website: lead.website,
            resolvedWebsite: websiteUrl,
            business_name: lead.business_name,
          };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }

      // Small delay between batches
      if (i + batchSize < leads.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const enrichedCount = results.filter(r => r.email).length;

    console.log(`[Enrich] Processed ${leads.length} leads, found ${enrichedCount} emails`);

    return NextResponse.json({
      results,
      total: leads.length,
      enriched: enrichedCount,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Enrichment failed';
    console.error('Enrich Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
