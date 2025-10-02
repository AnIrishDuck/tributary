import * as nacl from 'tweetnacl';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Define the key pair interface
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

// Get the home directory and create a .tributary folder
const homeDir = os.homedir();
const tributaryDir = path.join(homeDir, '.tributary');
const keysDir = path.join(tributaryDir, 'keys');

// Ensure the directories exist
async function ensureDirectories() {
  await fs.ensureDir(tributaryDir);
  await fs.ensureDir(keysDir);
}

// Generate a new key pair
export function generateKeyPair(): KeyPair {
  return nacl.sign.keyPair();
}

// Save a key pair to disk
export async function saveKeyPair(name: string, keyPair: KeyPair): Promise<void> {
  await ensureDirectories();
  
  const keyPath = path.join(keysDir, `${name}.json`);
  const keyData = {
    publicKey: Buffer.from(keyPair.publicKey).toString('base64'),
    secretKey: Buffer.from(keyPair.secretKey).toString('base64')
  };
  
  await fs.writeJson(keyPath, keyData, { spaces: 2 });
}

// Load a key pair from disk
export async function loadKeyPair(name: string): Promise<KeyPair> {
  const keyPath = path.join(keysDir, `${name}.json`);
  
  if (!await fs.pathExists(keyPath)) {
    throw new Error(`Key '${name}' not found`);
  }
  
  const keyData = await fs.readJson(keyPath);
  return {
    publicKey: Uint8Array.from(Buffer.from(keyData.publicKey, 'base64')),
    secretKey: Uint8Array.from(Buffer.from(keyData.secretKey, 'base64'))
  };
}

// List all available keys
export async function listKeys(): Promise<string[]> {
  await ensureDirectories();
  
  const files = await fs.readdir(keysDir);
  return files
    .filter(file => file.endsWith('.json'))
    .map(file => path.basename(file, '.json'));
}

// Show details of a specific key
export async function showKey(name: string): Promise<{ publicKey: string }> {
  const keyPair = await loadKeyPair(name);
  return {
    publicKey: Buffer.from(keyPair.publicKey).toString('base64')
  };
}
