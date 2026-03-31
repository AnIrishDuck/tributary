import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Server } from './server.js';
import { TributaryServer } from './tributaryServer.js';
import { deriveAuthKey } from './kdf.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const AUTH_DIR = path.join(os.homedir(), '.tributary');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

interface StoredAuth {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function getCliEnv() {
  const cliUrl = process.env.TRIBUTARY_CLI_URL;
  const cliKey = process.env.TRIBUTARY_CLI_KEY;
  if (!cliUrl) {
    throw new Error('TRIBUTARY_CLI_URL environment variable must be set');
  }
  if (!cliKey) {
    throw new Error('TRIBUTARY_CLI_KEY environment variable must be set');
  }
  return { cliUrl, cliKey };
}

function createSupabase() {
  const { cliUrl, cliKey } = getCliEnv();
  const supabaseUrl = new URL(cliUrl).origin;
  return createSupabaseClient(supabaseUrl, cliKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function readAuthFile(): StoredAuth | null {
  try {
    const data = fs.readFileSync(AUTH_FILE, 'utf8');
    return JSON.parse(data) as StoredAuth;
  } catch {
    return null;
  }
}

function writeAuthFile(auth: StoredAuth) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

export async function cliLogin(email: string, password: string): Promise<void> {
  const supabase = createSupabase();
  const authKey = await deriveAuthKey(password, email);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: authKey });
  if (error) {
    throw new Error(`Login failed: ${error.message}`);
  }
  const session = data.session;
  if (!session) {
    throw new Error('Login failed: no session returned');
  }
  writeAuthFile({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? 0,
  });
  supabase.auth.stopAutoRefresh();
}

export async function cliLogout(): Promise<void> {
  try {
    fs.unlinkSync(AUTH_FILE);
  } catch {
    // Already logged out
  }
}

export async function getCliAuthToken(): Promise<string | null> {
  const auth = readAuthFile();
  if (!auth) {
    return null;
  }

  // If token is still valid (with 60s buffer), return it
  const now = Math.floor(Date.now() / 1000);
  if (auth.expires_at > now + 60) {
    return auth.access_token;
  }

  // Token expired — refresh it
  const supabase = createSupabase();
  const { data, error } = await supabase.auth.setSession({
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
  });
  if (error || !data.session) {
    logger.warn('Token refresh failed. Please run login again.');
    await supabase.auth.signOut({ scope: 'local' });
    return null;
  }
  writeAuthFile({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? 0,
  });
  await supabase.auth.signOut({ scope: 'local' });
  return data.session.access_token;
}

export async function createCliServer(): Promise<Server> {
  const { cliUrl, cliKey } = getCliEnv();
  const server = new TributaryServer(cliUrl, cliKey);
  const authToken = await getCliAuthToken();
  if (authToken) {
    server.setWriteAuthToken(authToken);
  }
  return server;
}
