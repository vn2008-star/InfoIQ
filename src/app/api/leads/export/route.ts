import { getSupabaseClient } from '@/lib/supabase';

function getClient(projectId: string) {
  if (!projectId || projectId === 'csv_only') return null;
  return getSupabaseClient(projectId);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || 'glowup';
    const state = searchParams.get('state') || '';
    const city = searchParams.get('city') || '';
    const status = searchParams.get('status') || '';
    const industry = searchParams.get('industry') || '';
    const hasEmail = searchParams.get('hasEmail') || '';
    const search = searchParams.get('search') || '';

    const supabase = getClient(projectId);
    if (!supabase) {
      return new Response('Project not connected', { status: 400 });
    }

    // Fetch ALL matching leads (paginate in batches of 1000)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allLeads: any[] = [];
    const batchSize = 1000;
    let offset = 0;

    while (true) {
      let query = supabase
        .from('leads')
        .select('business_name, industry, address, city, state, phone, email, website, rating, review_count, google_maps_url, source, status');

      if (state) {
        const vals = state.split(',').map(s => s.trim()).filter(Boolean);
        query = vals.length === 1 ? query.eq('state', vals[0]) : query.in('state', vals);
      }
      if (city) {
        const vals = city.split(',').map(s => s.trim()).filter(Boolean);
        query = vals.length === 1 ? query.eq('city', vals[0]) : query.in('city', vals);
      }
      if (status && status !== 'All') query = query.eq('status', status);
      if (industry) {
        const vals = industry.split(',').map(s => s.trim()).filter(Boolean);
        query = vals.length === 1 ? query.eq('industry', vals[0]) : query.in('industry', vals);
      }
      if (hasEmail === 'yes') query = query.not('email', 'is', null).neq('email', '');
      if (hasEmail === 'no') query = query.or('email.is.null,email.eq.');
      if (search) query = query.ilike('business_name', `%${search}%`);

      const { data, error } = await query
        .order('state', { ascending: true })
        .order('city', { ascending: true })
        .order('business_name', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      allLeads.push(...data);
      if (data.length < batchSize) break;
      offset += batchSize;
    }

    // Build CSV
    const headers = ['Business Name', 'Industry', 'Address', 'City', 'State', 'Phone', 'Email', 'Website', 'Rating', 'Reviews', 'Google Maps URL', 'Source', 'Status'];
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
    const rows = allLeads.map(l => [
      esc(l.business_name), esc(l.industry), esc(l.address),
      esc(l.city), esc(l.state), esc(l.phone), esc(l.email), esc(l.website),
      esc(String(l.rating || '')), esc(String(l.review_count || '')),
      esc(l.google_maps_url), esc(l.source), esc(l.status),
    ].join(','));
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');

    // Build descriptive filename
    const parts: string[] = ['InfoIQ'];
    if (industry) parts.push(industry.replace(/\s+/g, ''));
    if (state) parts.push(state);
    if (city) parts.push(city.replace(/\s+/g, ''));
    if (hasEmail === 'yes') parts.push('WithEmail');
    if (hasEmail === 'no') parts.push('NoEmail');
    if (status) parts.push(status.replace(/\s+/g, ''));
    if (search) parts.push(search.replace(/\s+/g, ''));
    if (parts.length === 1) parts.push('AllLeads');
    parts.push(`${allLeads.length}leads`);
    parts.push(new Date().toISOString().slice(0, 10));
    const filename = parts.join('_') + '.csv';

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Export failed';
    console.error('Export CSV Error:', msg);
    return new Response(msg, { status: 500 });
  }
}
