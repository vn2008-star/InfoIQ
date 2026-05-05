import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { isValidBusinessEmail } from '@/lib/email-utils';

// ════════════════════════════════════════════════════════
// POST /api/leads/import
// Import CSV data — match against existing leads by name+city
// and update emails, or insert new leads.
// ════════════════════════════════════════════════════════

interface ImportRow {
  business_name: string;
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  rating?: number;
  review_count?: number;
}

export async function POST(request: Request) {
  try {
    const { rows, projectId = 'glowup', mode = 'update' } = await request.json();
    // mode: 'update' = only update existing leads | 'upsert' = update + insert new

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'No rows to import' }, { status: 400 });
    }

    const supabase = getSupabaseClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
    }

    let emailsUpdated = 0;
    let websitesUpdated = 0;
    let phonesUpdated = 0;
    let newLeadsInserted = 0;
    let matched = 0;
    let skippedInvalidEmail = 0;
    let notFound = 0;
    const errors: string[] = [];

    // Process each row
    for (const row of rows as ImportRow[]) {
      if (!row.business_name) continue;

      const name = row.business_name.trim();
      const city = (row.city || '').trim();

      // Try to find existing lead by business_name + city
      let query = supabase
        .from('leads')
        .select('id, business_name, email, phone, website, city')
        .ilike('business_name', name);

      if (city) {
        query = query.ilike('city', city);
      }

      const { data: existing, error: findErr } = await query.limit(1);

      if (findErr) {
        errors.push(`Error finding "${name}": ${findErr.message}`);
        continue;
      }

      if (existing && existing.length > 0) {
        // Found a match — update fields that are missing
        matched++;
        const lead = existing[0];
        const updates: Record<string, unknown> = {};

        // Update email if we have a new valid one and lead doesn't already have one
        if (row.email && (!lead.email || lead.email === '')) {
          if (isValidBusinessEmail(row.email)) {
            updates.email = row.email.trim();
            updates.enrichment_attempted = true;
            emailsUpdated++;
          } else {
            skippedInvalidEmail++;
          }
        }

        // Update website if missing
        if (row.website && (!lead.website || lead.website === '')) {
          updates.website = row.website.trim();
          websitesUpdated++;
        }

        // Update phone if missing
        if (row.phone && (!lead.phone || lead.phone === '')) {
          updates.phone = row.phone.trim();
          phonesUpdated++;
        }

        if (Object.keys(updates).length > 0) {
          const { error: updErr } = await supabase
            .from('leads')
            .update(updates)
            .eq('id', lead.id);

          if (updErr) {
            errors.push(`Error updating "${name}": ${updErr.message}`);
          }
        }
      } else if (mode === 'upsert') {
        // No match found — insert as new lead
        notFound++;
        const newLead: Record<string, unknown> = {
          business_name: name,
          industry: 'Nail Salon', // Default — can be changed
          address: row.address || '',
          city: city,
          state: row.state || '',
          country: 'US',
          phone: row.phone || null,
          email: row.email && isValidBusinessEmail(row.email) ? row.email : null,
          website: row.website || null,
          rating: row.rating || null,
          review_count: row.review_count || null,
          source: 'CSV Import',
          status: 'New',
          enrichment_attempted: !!(row.email && isValidBusinessEmail(row.email)),
        };

        const { error: insErr } = await supabase
          .from('leads')
          .insert(newLead);

        if (insErr) {
          errors.push(`Error inserting "${name}": ${insErr.message}`);
        } else {
          newLeadsInserted++;
        }
      } else {
        notFound++;
      }
    }

    return NextResponse.json({
      total: rows.length,
      matched,
      emailsUpdated,
      websitesUpdated,
      phonesUpdated,
      newLeadsInserted,
      skippedInvalidEmail,
      notFound,
      errors: errors.slice(0, 10),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Import failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
