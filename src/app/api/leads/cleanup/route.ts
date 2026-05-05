import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { isValidBusinessEmail } from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// POST /api/leads/cleanup
// Scans leads with emails and removes junk/invalid ones
// ════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const { projectId = 'glowup', dryRun = true } = await request.json();

    const supabase = getSupabaseClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
    }

    // Fetch all leads that have an email
    const { data: leadsWithEmail, error } = await supabase
      .from('leads')
      .select('id, business_name, email, city')
      .not('email', 'is', null)
      .neq('email', '');

    if (error) throw error;

    const junkEmails: { id: string; business_name: string; email: string; city: string }[] = [];
    const validEmails: { id: string; business_name: string; email: string }[] = [];

    for (const lead of leadsWithEmail || []) {
      if (!isValidBusinessEmail(lead.email)) {
        junkEmails.push(lead);
      } else {
        validEmails.push(lead);
      }
    }

    // If not dry run, clear the junk emails
    if (!dryRun && junkEmails.length > 0) {
      const junkIds = junkEmails.map(j => j.id);
      // Process in batches of 100
      for (let i = 0; i < junkIds.length; i += 100) {
        const batch = junkIds.slice(i, i + 100);
        await supabase
          .from('leads')
          .update({ email: null, enrichment_attempted: false })
          .in('id', batch);
      }
    }

    return NextResponse.json({
      total: leadsWithEmail?.length || 0,
      valid: validEmails.length,
      junk: junkEmails.length,
      dryRun,
      cleaned: dryRun ? 0 : junkEmails.length,
      junkSamples: junkEmails.slice(0, 20).map(j => ({
        business: j.business_name,
        email: j.email,
        city: j.city,
      })),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Cleanup failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
