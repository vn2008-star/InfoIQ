import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import {
  extractEmails,
  pickBestEmail,
  isYelpListingUrl,
  resolveWebsiteByGuessing,
  scrapeEmailFromWebsite,
} from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// Multi-Strategy Batch Email Enrichment Pipeline
//
// Strategy cascade (each only runs if previous failed):
//   1. Website scraping (expanded: 9 subpages) — FREE
//   2. Google Search email discovery — FREE (100/day CSE)
//   3. Social profile scraping (FB/IG/Yelp) — FREE
//   4. Apify Google Maps (selective) — PAID (user must opt-in)
// ════════════════════════════════════════════════════════

interface LeadRow {
  id: string;
  business_name: string;
  website: string | null;
  city?: string;
  state?: string;
  email?: string | null;
}

interface EnrichResult {
  id: string;
  email: string;
  website: string;
  source: string; // which strategy found the email
}

// ────────────────────────────────────────────────────
// Strategy 1: Website scraping (enhanced with expanded pages)
// ────────────────────────────────────────────────────

async function tryWebsiteScraping(
  lead: LeadRow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
): Promise<{ email: string | null; resolvedWebsite: string | null }> {
  const websiteUrl = lead.website || '';
  let resolvedWebsite: string | null = null;

  // Resolve Yelp URLs to real website
  if (isYelpListingUrl(websiteUrl)) {
    if (websiteUrl.includes('biz_redir')) {
      try {
        const u = new URL(websiteUrl);
        resolvedWebsite = u.searchParams.get('url') || null;
      } catch { /* ignore */ }
    }
    if (!resolvedWebsite) {
      resolvedWebsite = await resolveWebsiteByGuessing(lead.business_name, lead.city);
    }
  } else if (websiteUrl && !websiteUrl.includes('yelp.com')) {
    resolvedWebsite = websiteUrl;
  }

  if (!resolvedWebsite) return { email: null, resolvedWebsite: null };

  // Ensure protocol
  if (!resolvedWebsite.startsWith('http')) {
    resolvedWebsite = 'https://' + resolvedWebsite;
  }

  // Scrape the resolved website (now with expanded subpages)
  const { email } = await scrapeEmailFromWebsite(resolvedWebsite);

  // Update the website URL if we resolved it from Yelp
  if (resolvedWebsite !== websiteUrl) {
    await supabase.from('leads').update({ website: resolvedWebsite }).eq('id', lead.id);
  }

  return { email, resolvedWebsite };
}

// ────────────────────────────────────────────────────
// Strategy 2: Google Search email discovery
// ────────────────────────────────────────────────────

async function tryGoogleSearch(lead: LeadRow): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/enrich/google-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: lead.business_name,
        city: lead.city,
        state: lead.state,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data.email || null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────
// Strategy 3: Social profile scraping
// ────────────────────────────────────────────────────

async function trySocialScraping(lead: LeadRow): Promise<string | null> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/enrich/social-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessName: lead.business_name,
        city: lead.city,
        state: lead.state,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json();
    return data.email || null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────
// Full enrichment pipeline — cascading strategies
// ────────────────────────────────────────────────────

async function enrichLead(
  lead: LeadRow,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  enableGoogle: boolean = true,
  enableSocial: boolean = true,
): Promise<EnrichResult | null> {
  let email: string | null = null;
  let source = '';
  let resolvedWebsite = lead.website || '';

  // ── Strategy 1: Website scraping (expanded) ──
  const websiteResult = await tryWebsiteScraping(lead, supabase);
  if (websiteResult.email) {
    email = websiteResult.email;
    source = 'website';
    resolvedWebsite = websiteResult.resolvedWebsite || resolvedWebsite;
  }

  // ── Strategy 2: Google Search ──
  if (!email && enableGoogle) {
    email = await tryGoogleSearch(lead);
    if (email) source = 'google_search';
  }

  // ── Strategy 3: Social profiles ──
  if (!email && enableSocial) {
    email = await trySocialScraping(lead);
    if (email) source = 'social';
  }

  // Update database
  if (email) {
    const { data: upd, error: updErr } = await supabase.from('leads').update({
      email,
      enrichment_attempted: true,
      ...(resolvedWebsite !== lead.website ? { website: resolvedWebsite } : {}),
    }).eq('id', lead.id).select('id, email');

    if (updErr) {
      console.error(`[Enrich] ❌ DB error saving email for ${lead.business_name}: ${updErr.message}`);
    } else if (!upd || upd.length === 0) {
      console.error(`[Enrich] ❌ 0 rows updated for ${lead.business_name} (id: ${lead.id})`);
    } else {
      console.log(`[Enrich] ✅ Saved: ${lead.business_name} → ${upd[0].email} (${source})`);
    }
    return { id: lead.id, email, website: resolvedWebsite, source };
  }

  // Mark as attempted even if no email found
  await supabase.from('leads').update({ enrichment_attempted: true }).eq('id', lead.id);
  return null;
}

// ════════════════════════════════════════════════════════
// POST /api/enrich/batch — multi-strategy batch enrichment
// ════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const {
      projectId,
      batchSize = 3,        // lower default for multi-strategy (more work per lead)
      offset = 0,
      limit = 30,
      industry,
      state,
      city,
      enableGoogle = true,  // enable Google Search strategy
      enableSocial = true,  // enable Social profile strategy
      enableApify = false,  // Apify is opt-in only
    } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    const supabase = getSupabaseClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
    }

    // Fetch leads that haven't been enrichment-attempted yet
    // No website filter — Google Search + Social strategies work by name alone
    let query = supabase
      .from('leads')
      .select('id, business_name, website, email, city, state', { count: 'exact' })
      .or('email.is.null,email.eq.')
      .or('enrichment_attempted.is.null,enrichment_attempted.eq.false');

    if (industry) {
      const vals = industry.split(',').map((s: string) => s.trim()).filter(Boolean);
      query = vals.length === 1 ? query.eq('industry', vals[0]) : query.in('industry', vals);
    }
    if (state) {
      const vals = state.split(',').map((s: string) => s.trim()).filter(Boolean);
      query = vals.length === 1 ? query.eq('state', vals[0]) : query.in('state', vals);
    }
    if (city) {
      const vals = city.split(',').map((s: string) => s.trim()).filter(Boolean);
      query = vals.length === 1 ? query.eq('city', vals[0]) : query.in('city', vals);
    }

    const { data: leads, error: fetchError, count } = await query
      .range(offset, offset + limit - 1)
      .order('created_at', { ascending: true });

    if (fetchError) throw new Error(fetchError.message);
    if (!leads || leads.length === 0) {
      return NextResponse.json({ done: true, enriched: 0, processed: 0, remaining: 0 });
    }

    let enrichedCount = 0;
    const results: EnrichResult[] = [];
    const sourceStats: Record<string, number> = {};

    // Process in small parallel batches
    for (let i = 0; i < leads.length; i += batchSize) {
      const batch = leads.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map((lead) =>
          enrichLead(lead as LeadRow, supabase, enableGoogle, enableSocial)
        )
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
          enrichedCount++;
          sourceStats[r.value.source] = (sourceStats[r.value.source] || 0) + 1;
        }
      }

      // Rate-limit between batches
      if (i + batchSize < leads.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── Strategy 4: Apify (opt-in, runs on remaining unenriched leads) ──
    let apifyResults: EnrichResult[] = [];
    if (enableApify && results.length < leads.length) {
      const unenrichedLeads = leads
        .filter((lead) => !results.find(r => r.id === lead.id))
        .map((lead) => ({
          id: lead.id,
          business_name: lead.business_name,
          city: lead.city,
          state: lead.state,
        }));

      if (unenrichedLeads.length > 0) {
        try {
          const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
          console.log(`[Batch Enrich] Calling Apify for ${unenrichedLeads.length} leads...`);
          const apifyRes = await fetch(`${baseUrl}/api/enrich/apify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ leads: unenrichedLeads, maxBatchSize: 20 }),
            signal: AbortSignal.timeout(360000), // 6 min timeout for Apify
          });
          const apifyData = await apifyRes.json();
          console.log(`[Batch Enrich] Apify returned: ${apifyData.matched || 0} matches from ${apifyData.total || 0} leads`);

          if (apifyData.results && apifyData.results.length > 0) {
            for (const r of apifyData.results) {
              // Update database with explicit error checking
              const { data: updateData, error: updateError } = await supabase
                .from('leads')
                .update({
                  email: r.email,
                  enrichment_attempted: true,
                })
                .eq('id', r.id)
                .select('id, email');

              if (updateError) {
                console.error(`[Batch Enrich] ❌ FAILED to save Apify email for ${r.id}: ${updateError.message}`);
              } else if (!updateData || updateData.length === 0) {
                console.error(`[Batch Enrich] ❌ UPDATE returned 0 rows for ${r.id} — RLS blocking or ID mismatch`);
              } else {
                console.log(`[Batch Enrich] ✅ Saved Apify email: ${updateData[0].email} for lead ${r.id}`);
                results.push(r);
                enrichedCount++;
                sourceStats['apify'] = (sourceStats['apify'] || 0) + 1;
              }
            }
            apifyResults = apifyData.results;
          }
        } catch (err) {
          console.warn('[Batch Enrich] Apify strategy failed:', err);
        }
      }
    }

    console.log(`[Batch Enrich] Processed ${leads.length} leads, found ${enrichedCount} emails (offset: ${offset})`);
    console.log(`[Batch Enrich] Source breakdown:`, sourceStats);

    return NextResponse.json({
      done: (offset + leads.length) >= (count || 0),
      enriched: enrichedCount,
      processed: leads.length,
      remaining: Math.max(0, (count || 0) - offset - leads.length),
      totalEnrichable: count || 0,
      results,
      sourceStats,
      apifyUsed: enableApify,
      apifyFound: apifyResults.length,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Enrichment failed';
    console.error('Batch Enrich Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ════════════════════════════════════════════════════════
// GET /api/enrich/batch — count enrichable leads
// ════════════════════════════════════════════════════════

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || 'glowup';
    const industry = searchParams.get('industry') || '';
    const state = searchParams.get('state') || '';
    const city = searchParams.get('city') || '';

    const supabase = getSupabaseClient(projectId);
    if (!supabase) {
      return NextResponse.json({ enrichable: 0 });
    }

    let query = supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .or('email.is.null,email.eq.')
      .or('enrichment_attempted.is.null,enrichment_attempted.eq.false');

    if (industry) {
      const vals = industry.split(',').map((s: string) => s.trim()).filter(Boolean);
      query = vals.length === 1 ? query.eq('industry', vals[0]) : query.in('industry', vals);
    }
    if (state) {
      const vals = state.split(',').map((s: string) => s.trim()).filter(Boolean);
      query = vals.length === 1 ? query.eq('state', vals[0]) : query.in('state', vals);
    }
    if (city) {
      const vals = city.split(',').map((s: string) => s.trim()).filter(Boolean);
      query = vals.length === 1 ? query.eq('city', vals[0]) : query.in('city', vals);
    }

    const { count } = await query;

    return NextResponse.json({ enrichable: count || 0 });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ enrichable: 0, error: msg });
  }
}

// ════════════════════════════════════════════════════════
// PATCH /api/enrich/batch — reset enrichment_attempted for retry
// ════════════════════════════════════════════════════════

export async function PATCH(request: Request) {
  try {
    const { projectId, industry, state, city } = await request.json();

    const supabase = getSupabaseClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: 'Project not connected' }, { status: 400 });
    }

    // Step 1: Find IDs of leads that were attempted but still have no email
    let selectQuery = supabase
      .from('leads')
      .select('id')
      .eq('enrichment_attempted', true)
      .or('email.is.null,email.eq.');

    if (industry) {
      const vals = industry.split(',').map((s: string) => s.trim()).filter(Boolean);
      selectQuery = vals.length === 1 ? selectQuery.eq('industry', vals[0]) : selectQuery.in('industry', vals);
    }
    if (state) {
      const vals = state.split(',').map((s: string) => s.trim()).filter(Boolean);
      selectQuery = vals.length === 1 ? selectQuery.eq('state', vals[0]) : selectQuery.in('state', vals);
    }
    if (city) {
      const vals = city.split(',').map((s: string) => s.trim()).filter(Boolean);
      selectQuery = vals.length === 1 ? selectQuery.eq('city', vals[0]) : selectQuery.in('city', vals);
    }

    const { data: rows, error: selectError } = await selectQuery.limit(5000);
    if (selectError) throw new Error(selectError.message);

    const ids = (rows || []).map((r: { id: string }) => r.id);

    if (ids.length === 0) {
      console.log('[Reset Enrichment] No leads to reset');
      return NextResponse.json({ reset: 0 });
    }

    // Step 2: Update in batches of 500
    let totalReset = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const { error: updateError } = await supabase
        .from('leads')
        .update({ enrichment_attempted: false })
        .in('id', batch);
      if (updateError) throw new Error(updateError.message);
      totalReset += batch.length;
    }

    console.log(`[Reset Enrichment] Reset ${totalReset} leads for retry`);
    return NextResponse.json({ reset: totalReset });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Reset failed';
    console.error('Reset Enrichment Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

