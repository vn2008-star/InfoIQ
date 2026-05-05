import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';

/**
 * Fetch ALL rows for a single column by paginating in batches of 1000.
 * Supabase REST API caps at ~1000 rows per request, so we must paginate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllColumn(supabase: any, column: string, filters?: Record<string, string>): Promise<string[]> {
  const PAGE = 1000;
  const allValues: string[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('leads')
      .select(column)
      .not(column, 'is', null)
      .not(column, 'eq', '')
      .range(offset, offset + PAGE - 1);

    // Apply any extra equality filters (e.g. state = 'CA')
    if (filters) {
      for (const [key, val] of Object.entries(filters)) {
        query = query.eq(key, val);
      }
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of data) {
      if (row[column]) allValues.push(row[column]);
    }

    // If we got fewer than PAGE rows, we've reached the end
    if (data.length < PAGE) {
      hasMore = false;
    } else {
      offset += PAGE;
    }
  }

  return allValues;
}

/** Count occurrences and return sorted { value, count }[] */
function countValues(values: string[], sortBy: 'alpha' | 'count' = 'alpha'): { value: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const v of values) {
    counts[v] = (counts[v] || 0) + 1;
  }
  const entries = Object.entries(counts).map(([value, count]) => ({ value, count }));
  return sortBy === 'count'
    ? entries.sort((a, b) => b.count - a.count)
    : entries.sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * GET /api/leads/filters
 * Returns distinct industries, states, cities (cascading), and summary counts.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || 'glowup';
    const state = searchParams.get('state') || '';

    const supabase = getSupabaseClient(projectId);
    if (!supabase) {
      return NextResponse.json({ industries: [], states: [], cities: [], totalLeads: 0 });
    }

    // Total count (uses head: true, so no row limit issue)
    const { count: totalLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true });

    // Fetch all industries, states in parallel
    const [industryValues, stateValues] = await Promise.all([
      fetchAllColumn(supabase, 'industry'),
      fetchAllColumn(supabase, 'state'),
    ]);

    const industries = countValues(industryValues, 'count');
    const states = countValues(stateValues, 'alpha');

    // Cities — filtered by state(s) when selected, otherwise all cities
    let cityValues: string[] = [];
    if (state) {
      const stateVals = state.split(',').map(s => s.trim()).filter(Boolean);
      if (stateVals.length === 1) {
        cityValues = await fetchAllColumn(supabase, 'city', { state: stateVals[0] });
      } else {
        // Fetch cities for each selected state in parallel
        const cityArrays = await Promise.all(
          stateVals.map(sv => fetchAllColumn(supabase, 'city', { state: sv }))
        );
        cityValues = cityArrays.flat();
      }
    } else {
      cityValues = await fetchAllColumn(supabase, 'city');
    }
    const cities = countValues(cityValues, 'alpha');

    // Email stats (head: true = no row limit)
    const { count: withEmail } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .not('email', 'is', null)
      .neq('email', '');

    return NextResponse.json({
      industries,
      states,
      cities,
      totalLeads: totalLeads || 0,
      withEmail: withEmail || 0,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Filters Error:', msg);
    return NextResponse.json({ industries: [], states: [], cities: [], totalLeads: 0, error: msg });
  }
}
