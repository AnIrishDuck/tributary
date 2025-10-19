// Test to verify crypto compatibility between Supabase functions and Rust server
import { assertEquals } from 'jsr:@std/assert@1';
import { computeHash, computeChainHash } from '../shared/crypto.ts';

Deno.test('Hash compatibility with client/server', async () => {
  // Test the exact same data that the client/server tests use
  const test_data = new TextEncoder().encode('test data for hashing');
  const prior_hash = 'abc123def456';

  // Compute using Supabase function implementation
  const body_hash = await computeHash(test_data);
  const chain_hash = await computeChainHash(prior_hash, test_data);

  // These should match exactly what the client/server produces:
  assertEquals(
    body_hash,
    'f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5'
  );
  assertEquals(
    chain_hash,
    'e8910954652f2957dd5b6f34d88c78ff7f086546e2b94aef687290d409519a67'
  );
});

Deno.test('Hash compatibility with Hello Tributary test', async () => {
  const test_data = new TextEncoder().encode('Hello, Tributary!');
  const prior_hash = 'a1b2c3d4e5f';

  const body_hash = await computeHash(test_data);
  const chain_hash = await computeChainHash(prior_hash, test_data);

  assertEquals(
    body_hash,
    '692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57'
  );
  assertEquals(
    chain_hash,
    'c6a7678f0c10c4ef797589575b0c8ffc108ee965cf1c06fef71cec3edc867b91'
  );
});

Deno.test('Chain hash without prior', async () => {
  // Test chain hash computation when there is no prior hash (first entry)
  const test_data = new TextEncoder().encode('First entry');
  const prior_hash = ''; // Empty prior hash for first entry

  const body_hash = await computeHash(test_data);
  const chain_hash = await computeChainHash(prior_hash, test_data);

  assertEquals(
    body_hash,
    '7749435cc893289da9df793cdb29ba90e082e57e6a60f4019b1d22f57bc3bf40'
  );
  assertEquals(
    chain_hash,
    'f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641'
  );
});

Deno.test('Chain hash with real prior', async () => {
  // Test chain hash computation with a real prior hash (simulating actual chaining)
  const test_data = new TextEncoder().encode('Second entry');
  const prior_hash = 'f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641'; // hash from previous test

  const body_hash = await computeHash(test_data);
  const chain_hash = await computeChainHash(prior_hash, test_data);

  assertEquals(
    body_hash,
    'f5f5fd73d02a1535460e64279b2aa672309c80b129f28efe2ab523f32d1e91be'
  );
  assertEquals(
    chain_hash,
    'b17d1dcc5867c9dbaf798b1d7cd91168a362702d4acfd0f8f997c7390aaf65f9'
  );
});
