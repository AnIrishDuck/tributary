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

// Storage config database interface for testability
export interface StorageConfigDb {
  getServerUrl(userId: string): Promise<string | null>;
  setServerUrl(userId: string, serverUrl: string): Promise<void>;
  deleteServerUrl(userId: string): Promise<void>;
}

// User authenticator type — returns user ID or null
export type StorageAuthenticator = (req: Request) => Promise<{ id: string } | null>;

// Create the route handler with injectable dependencies
export function createStorageHandler(db: StorageConfigDb, authenticate: StorageAuthenticator) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const user = await authenticate(req);
    if (!user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (req.method === 'GET') {
      const serverUrl = await db.getServerUrl(user.id);
      return jsonResponse({ server_url: serverUrl }, 200);
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

      await db.setServerUrl(user.id, body.server_url);
      return jsonResponse({ server_url: body.server_url }, 200);
    }

    if (req.method === 'DELETE') {
      await db.deleteServerUrl(user.id);
      return jsonResponse({ server_url: null }, 200);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  };
}

// Supabase-backed implementations for production use

function supabaseAuthenticator(): StorageAuthenticator {
  return async (req: Request) => {
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
    return { id: user.id };
  };
}

function supabaseStorageConfigDb(): StorageConfigDb {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async getServerUrl(userId: string): Promise<string | null> {
      const { data, error } = await supabase
        .from('user_storage_servers')
        .select('server_url')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('DB error:', error);
        throw new Error('Database error');
      }
      return data?.server_url ?? null;
    },

    async setServerUrl(userId: string, serverUrl: string): Promise<void> {
      const { error } = await supabase
        .from('user_storage_servers')
        .upsert({
          user_id: userId,
          server_url: serverUrl,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) {
        console.error('DB error:', error);
        throw new Error('Database error');
      }
    },

    async deleteServerUrl(userId: string): Promise<void> {
      const { error } = await supabase
        .from('user_storage_servers')
        .delete()
        .eq('user_id', userId);

      if (error) {
        console.error('DB error:', error);
        throw new Error('Database error');
      }
    },
  };
}

// Production handler
const handler = createStorageHandler(supabaseStorageConfigDb(), supabaseAuthenticator());

Deno.serve(handler);
