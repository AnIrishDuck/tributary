import nacl from 'tweetnacl';
import { TributaryClient } from 'tributary-client';
import * as base64url from 'urlsafe-base64';

// Define the key pair interface
export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

// Generate a new key pair
export function generateKeyPair(): KeyPair {
  return nacl.sign.keyPair();
}

// Save a key pair to the database via TributaryClient
export async function saveKeyPair(client: TributaryClient, appId: string, keyPair: KeyPair): Promise<string> {
  const stream = await client.addWriteKey(appId, keyPair.secretKey);
  const streamId = stream.getId();
  return streamId;
}

// Resolve a stream ID prefix to a unique full stream ID
export async function resolveStreamId(client: TributaryClient, streamIdPrefix: string): Promise<string> {
  const allKeys = await listKeys(client);
  const matchingKeys = allKeys.filter(key => key.startsWith(streamIdPrefix));

  if (matchingKeys.length === 0) {
    throw new Error(`No key found with prefix '${streamIdPrefix}'`);
  } else if (matchingKeys.length > 1) {
    throw new Error(`Multiple keys found with prefix '${streamIdPrefix}': ${matchingKeys.join(', ')}`);
  }

  return matchingKeys[0];
}

// Load a key pair from the database via TributaryClient
export async function loadKeyPair(client: TributaryClient, appId: string, streamId: string): Promise<KeyPair> {
  const fullStreamId = await resolveStreamId(client, streamId);
  
  // First try to get the stream directly
  const stream = await client.get(appId, fullStreamId);
  if (stream) {
    // For now, we'll create a placeholder since TributaryClient doesn't directly expose keys
    // In a real implementation, we'd need to store the private key in a secure way
    const publicKey = base64url.decode(fullStreamId); // Stream ID is base64 encoded public key
    return {
      publicKey: publicKey,
      secretKey: new Uint8Array(64) // Placeholder - in real implementation would retrieve from secure storage
    };
  }
  
  throw new Error(`Key with stream ID '${fullStreamId}' not found for app '${appId}'`);
}

// List all available keys from the database via TributaryClient
export async function listKeys(client: TributaryClient): Promise<string[]> {
  return await client.list();
}

// Show details of a specific key
export async function showKey(client: TributaryClient, appId: string, streamId: string): Promise<{ publicKey: string }> {
  const fullStreamId = await resolveStreamId(client, streamId);
  
  // Verify the key exists by trying to get it
  const stream = await client.get(appId, fullStreamId);
  if (!stream) {
    throw new Error(`Key with stream ID '${fullStreamId}' not found for app '${appId}'`);
  }
  
  return {
    publicKey: fullStreamId // Stream ID is the base64 encoded public key
  };
}

// Export a key as base64 encoded string
export async function exportKey(client: TributaryClient, appId: string, streamId: string): Promise<string> {
  const fullStreamId = await resolveStreamId(client, streamId);

  // Verify the key exists by trying to get it
  const stream = await client.get(appId, fullStreamId);
  if (!stream) {
    throw new Error(`Key with stream ID '${fullStreamId}' not found for app '${appId}'`);
  }

  // loadKeyPair with the full ID avoids a redundant prefix search
  const keyPair = await loadKeyPair(client, appId, fullStreamId);
  // Return the secret key as base64
  return base64url.encode(Buffer.from(keyPair.secretKey));
}

// Import a key from base64 encoded string
export async function importKey(client: TributaryClient, appId: string, base64Key: string): Promise<string> {
  // Decode the base64 key
  const secretKey = base64url.decode(base64Key);
  
  // Create a key pair
  const keyPair: KeyPair = {
    publicKey: new Uint8Array(secretKey.slice(32)), // Public key is last 32 bytes of secret key in Ed25519
    secretKey: new Uint8Array(secretKey)
  };
  
  // Save the key pair
  const streamId = await saveKeyPair(client, appId, keyPair);
  return streamId;
}
