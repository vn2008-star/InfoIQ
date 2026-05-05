import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/lib/supabase';
import { Lead } from '@/lib/types';

function getClient(projectId: string) {
  if (!projectId || projectId === 'csv_only') {
    return null;
  }
  const client = getSupabaseClient(projectId);
  if (!client) {
    throw new Error(`Project "${projectId}" is not connected. Check your environment variables.`);
  }
  return client;
}

// Save leads to a specific project's database
export async function POST(request: Request) {
  try {
    const { leads, projectId } = await request.json();

    if (!leads || !Array.isArray(leads)) {
      return NextResponse.json({ error: 'Invalid leads payload' }, { status: 400 });
    }

    if (!projectId || projectId === 'csv_only') {
      return NextResponse.json({ error: 'No database destination selected' }, { status: 400 });
    }

    const supabase = getClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
    }

    // Deduplicate: check which leads already exist by business_name + city
    const names = leads.map((l: Lead) => l.business_name);
    const { data: existing } = await supabase
      .from('leads')
      .select('business_name, city')
      .in('business_name', names);

    const existingSet = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (existing || []).map((e: any) => `${e.business_name}::${e.city}`.toLowerCase())
    );

    const newLeads = leads.filter(
      (l: Lead) => !existingSet.has(`${l.business_name}::${l.city}`.toLowerCase())
    );

    if (newLeads.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        duplicates: leads.length,
        message: 'All leads already exist in the database.',
      });
    }

    // Strip any client-side id/created_at fields before insert
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cleanLeads = newLeads.map(({ id, created_at, ...rest }: any) => rest);

    const { data, error } = await supabase
      .from('leads')
      .insert(cleanLeads)
      .select();

    if (error) {
      console.error('Supabase Insert Error:', error);
      throw new Error(error.message);
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      duplicates: leads.length - newLeads.length,
      data,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Save Leads Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Fetch leads with server-side filtering and pagination
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId') || 'glowup';
    const state = searchParams.get('state') || '';
    const city = searchParams.get('city') || '';
    const status = searchParams.get('status') || '';
    const industry = searchParams.get('industry') || '';
    const hasEmail = searchParams.get('hasEmail') || '';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '100', 10), 500);
    const search = searchParams.get('search') || '';

    const supabase = getClient(projectId);
    if (!supabase) {
      return NextResponse.json({ leads: [], total: 0, error: `Project "${projectId}" not connected` });
    }

    // Build the query with filters
    let query = supabase
      .from('leads')
      .select('*', { count: 'exact' });

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

    // Pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await query
      .order('state', { ascending: true })
      .order('city', { ascending: true })
      .order('business_name', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      leads: data || [],
      total: count || 0,
      page,
      pageSize,
      totalPages: Math.ceil((count || 0) / pageSize),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Fetch Leads Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Update lead status
export async function PATCH(request: Request) {
  try {
    const { id, status, projectId } = await request.json();

    if (!id || !status || !projectId) {
      return NextResponse.json({ error: 'Missing id, status, or projectId' }, { status: 400 });
    }

    const validStatuses = ['New', 'Contacted', 'Signed Up'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

    const supabase = getClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('leads')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Update Lead Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Delete a lead
export async function DELETE(request: Request) {
  try {
    const { id, projectId } = await request.json();

    if (!id || !projectId) {
      return NextResponse.json({ error: 'Missing lead id or projectId' }, { status: 400 });
    }

    const supabase = getClient(projectId);
    if (!supabase) {
      return NextResponse.json({ error: `Project "${projectId}" not connected` }, { status: 400 });
    }

    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal Server Error';
    console.error('Delete Lead Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
