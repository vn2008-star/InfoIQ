import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import {
  pickBestEmail,
  isYelpListingUrl,
  resolveWebsiteByGuessing,
  scrapeEmailFromWebsite,
} from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// Auto-Enrichment Agent (Self-Chaining Cron)
//
// Processes leads automatically without a browser tab open.
// Each invocation runs for ~50 seconds, then triggers
// itself to continue until all leads are processed.
//
// Trigger: Vercel Cron (daily) or manual GET request.
// Security: Requires CRON_SECRET header or query param.
// ════════════════════════════════════════════════════════

export const maxDuration = 60; // Vercel Hobby limit

const BATCH_SIZE = 5;        // leads per parallel batch
const LEADS_PER_RUN = 20;    // leads per invocation
const MAX_CHAINS = 50;       // safety: max self-chain depth per trigger
const RUN_TIME_LIMIT = 50_000; // 50 seconds (leave 10s buffer)

interface LeadRow {
  id: string;
  business_name: string;
  website: string | null;
  city?: string;
  state?: string;
  email?: string | null;
}

// ── Lightweight website-only enrichment (no external API calls to self) ──

async function enrichSingleLead(
  lead: LeadRow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<boolean> {
  let email: string | null = null;
  let resolvedWebsite = lead.website || '';

  // Strategy: Website scraping only (fast, free, no API calls)
  const websiteUrl = lead.website || '';

  if (websiteUrl) {
    let targetUrl = websiteUrl;

    // Resolve Yelp URLs
    if (isYelpListingUrl(websiteUrl)) {
      if (websiteUrl.includes('biz_redir')) {
        try {
          const u = new URL(websiteUrl);
          targetUrl = u.searchParams.get('url') || '';
        } catch { /* ignore */ }
      }
      if (!targetUrl || isYelpListingUrl(targetUrl)) {
        targetUrl = await resolveWebsiteByGuessing(lead.business_name, lead.city) || '';
      }
    }

    if (targetUrl && !isYelpListingUrl(targetUrl)) {
      if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

      const { email: scraped } = await scrapeEmailFromWebsite(targetUrl);
      if (scraped) {
        email = scraped;
        resolvedWebsite = targetUrl;
      }

      // Update website if resolved from Yelp
      if (targetUrl !== websiteUrl) {
        await supabase.from('leads').update({ website: targetUrl }).eq('id', lead.id);
      }
    }
  }

  // Google search fallback (direct, no self-call)
  if (!email) {
    try {
      const cseId = process.env.GOOGLE_CSE_ID;
      const apiKey = process.env.GOOGLE_CSE_API_KEY;

      if (cseId && apiKey) {
        const location = lead.city || lead.state || '';
        const query = `"${lead.business_name}" "${location}" email OR contact`;
        const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=3`;

        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          const items = data.items || [];
          const allEmails: string[] = [];

          // Extract from snippets
          for (const item of items) {
            const text = (item.snippet || '') + ' ' + (item.title || '');
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const found = text.match(emailRegex) || [];
            allEmails.push(...found);
          }

          const best = pickBestEmail([...new Set(allEmails)]);
          if (best) email = best;
        }
      }
    } catch {
      // CSE failed, continue
    }
  }

  // Save result
  if (email) {
    await supabase.from('leads').update({
      email,
      enrichment_attempted: true,
      ...(resolvedWebsite !== lead.website ? { website: resolvedWebsite } : {}),
    }).eq('id', lead.id);
    console.log(`[Agent] ✅ ${lead.business_name} → ${email}`);
    return true;
  }

  // Mark as attempted
  await supabase.from('leads').update({ enrichment_attempted: true }).eq('id', lead.id);
  return false;
}

// ── Main cron handler ──

export async function GET(request: Request) {
  // Security check
  const { searchParams } = new URL(request.url);
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
    || searchParams.get('secret');
  const expectedSecret = process.env.CRON_SECRET;

  if (expectedSecret && secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const chain = parseInt(searchParams.get('chain') || '0');
  const projectId = searchParams.get('project') || 'glowup';

  console.log(`[Agent] 🤖 Starting enrichment chain #${chain}`);

  const supabase = getSupabaseClient(projectId);
  if (!supabase) {
    return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
  }

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalEnriched = 0;

  try {
    // Process leads in batches until time runs out
    while (Date.now() - startTime < RUN_TIME_LIMIT) {
      // Fetch next batch of unenriched leads
      const { data: leads, error, count } = await supabase
        .from('leads')
        .select('id, business_name, website, email, city, state', { count: 'exact' })
        .or('email.is.null,email.eq.')
        .or('enrichment_attempted.is.null,enrichment_attempted.eq.false')
        .order('created_at', { ascending: true })
        .limit(LEADS_PER_RUN);

      if (error) throw new Error(error.message);
      if (!leads || leads.length === 0) {
        console.log(`[Agent] ✅ All leads processed! No more remaining.`);
        return NextResponse.json({
          status: 'complete',
          message: 'All leads have been processed',
          chain,
          totalProcessed,
          totalEnriched,
        });
      }

      // Process in parallel sub-batches
      for (let i = 0; i < leads.length; i += BATCH_SIZE) {
        if (Date.now() - startTime >= RUN_TIME_LIMIT) break;

        const batch = leads.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((lead) => enrichSingleLead(lead as LeadRow, supabase))
        );

        for (const r of results) {
          totalProcessed++;
          if (r.status === 'fulfilled' && r.value) totalEnriched++;
        }

        // Small delay between sub-batches
        await new Promise(r => setTimeout(r, 300));
      }

      const remaining = (count || 0) - leads.length;
      console.log(`[Agent] Chain #${chain}: processed=${totalProcessed}, enriched=${totalEnriched}, remaining≈${remaining}`);

      // If we processed all fetched leads and there are more, continue the loop
      if (remaining <= 0) {
        return NextResponse.json({
          status: 'complete',
          chain,
          totalProcessed,
          totalEnriched,
        });
      }
    }

    // Time's almost up — self-chain to continue
    if (chain < MAX_CHAINS) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://info-iq.vercel.app';
      const nextUrl = `${baseUrl}/api/cron/enrich?chain=${chain + 1}&project=${projectId}${expectedSecret ? `&secret=${expectedSecret}` : ''}`;

      // Fire-and-forget: trigger next chain
      fetch(nextUrl, { signal: AbortSignal.timeout(5000) }).catch(() => {
        // Expected — we don't wait for it
      });

      console.log(`[Agent] ⏰ Time limit reached. Chaining to #${chain + 1}`);
    } else {
      console.log(`[Agent] 🛑 Max chain depth (${MAX_CHAINS}) reached. Stopping.`);
    }

    return NextResponse.json({
      status: 'chained',
      chain,
      nextChain: chain + 1,
      totalProcessed,
      totalEnriched,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[Agent] ❌ Error:`, msg);
    return NextResponse.json({ error: msg, chain, totalProcessed, totalEnriched }, { status: 500 });
  }
}
