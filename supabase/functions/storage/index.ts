// Storage config edge function
// Allows users to get/set their custom storage server URL.

import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const jwt = authHeader.slice(7);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return null;
  return user;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const user = await getUser(req);
  if (!user) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('user_storage_servers')
      .select('server_url')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('DB error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }

    return jsonResponse({ server_url: data?.server_url ?? null }, 200);
  }

  if (req.method === 'PUT') {
    let body: { server_url?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.server_url || typeof body.server_url !== 'string') {
      return jsonResponse({ error: 'server_url is required' }, 400);
    }

    // Validate URL format
    try {
      new URL(body.server_url);
    } catch {
      return jsonResponse({ error: 'Invalid URL format' }, 400);
    }

    const { error } = await supabase
      .from('user_storage_servers')
      .upsert({
        user_id: user.id,
        server_url: body.server_url,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('DB error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }

    return jsonResponse({ server_url: body.server_url }, 200);
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('user_storage_servers')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('DB error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }

    return jsonResponse({ server_url: null }, 200);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
};

Deno.serve(handler);
