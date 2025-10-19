// Unit tests for crypto functions
import { assertEquals } from 'jsr:@std/assert@1';
import { computeHash, computeChainHash, verifySignature } from '../../shared/crypto.ts';

Deno.test('computeHash - produces correct SHA256 hash', async () => {
  // Test with known input and expected output
  const testData = new TextEncoder().encode('Hello, Tributary!');
  const hash = await computeHash(testData);
  
  // This is the known SHA256 hash of "Hello, Tributary!"
  assertEquals(
    hash,
    '692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57'
  );
});

Deno.test('computeHash - handles empty data', async () => {
  const emptyData = new TextEncoder().encode('');
  const hash = await computeHash(emptyData);
  
  // SHA256 hash of empty string
  assertEquals(
    hash,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

Deno.test('computeChainHash - produces correct chain hash', async () => {
  const testData = new TextEncoder().encode('test data for hashing');
  const priorHash = 'abc123def456';
  
  const bodyHash = await computeHash(testData);
  const chainHash = await computeChainHash(priorHash, testData);
  
  assertEquals(
    bodyHash,
    'f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5'
  );
  assertEquals(
    chainHash,
    'e8910954652f2957dd5b6f34d88c78ff7f086546e2b94aef687290d409519a67'
  );
});

Deno.test('computeChainHash - works with empty prior hash', async () => {
  const testData = new TextEncoder().encode('First entry');
  const priorHash = '';
  
  const bodyHash = await computeHash(testData);
  const chainHash = await computeChainHash(priorHash, testData);
  
  assertEquals(
    bodyHash,
    '7749435cc893289da9df793cdb29ba90e082e57e6a60f4019b1d22f57bc3bf40'
  );
  assertEquals(
    chainHash,
    'f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641'
  );
});

Deno.test('computeChainHash - works with real chaining', async () => {
  const testData = new TextEncoder().encode('Second entry');
  const priorHash = 'f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641';
  
  const bodyHash = await computeHash(testData);
  const chainHash = await computeChainHash(priorHash, testData);
  
  assertEquals(
    bodyHash,
    'f5f5fd73d02a1535460e64279b2aa672309c80b129f28efe2ab523f32d1e91be'
  );
  assertEquals(
    chainHash,
    'b17d1dcc5867c9dbaf798b1d7cd91168a362702d4acfd0f8f997c7390aaf65f9'
  );
});
