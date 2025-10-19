// End-to-end compatibility tests
import { assertEquals } from 'jsr:@std/assert@1';
import { computeHash, computeChainHash } from '../../shared/crypto.ts';

Deno.test('Complete hash chain compatibility', async () => {
  // Test the complete chain as it would be processed by the server/client
  
  // First entry (no prior hash)
  const firstData = new TextEncoder().encode('First entry');
  const firstBodyHash = await computeHash(firstData);
  const firstChainHash = await computeChainHash('', firstData);
  
  assertEquals(
    firstBodyHash,
    '7749435cc893289da9df793cdb29ba90e082e57e6a60f4019b1d22f57bc3bf40'
  );
  assertEquals(
    firstChainHash,
    'f962b7ec0d0375d2ee951857e1209bd1c6f70b26626face9c948569718503641'
  );
  
  // Second entry (using first chain hash as prior)
  const secondData = new TextEncoder().encode('Second entry');
  const secondBodyHash = await computeHash(secondData);
  const secondChainHash = await computeChainHash(firstChainHash, secondData);
  
  assertEquals(
    secondBodyHash,
    'f5f5fd73d02a1535460e64279b2aa672309c80b129f28efe2ab523f32d1e91be'
  );
  assertEquals(
    secondChainHash,
    'b17d1dcc5867c9dbaf798b1d7cd91168a362702d4acfd0f8f997c7390aaf65f9'
  );
  
  // Third entry (using second chain hash as prior)
  const thirdData = new TextEncoder().encode('Hello, Tributary!');
  const thirdBodyHash = await computeHash(thirdData);
  const thirdChainHash = await computeChainHash(secondChainHash, thirdData);
  
  assertEquals(
    thirdBodyHash,
    '692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57'
  );
  assertEquals(
    thirdChainHash,
    '75297e4319d48fd5ce9b6b01a0d0132129643760b05fe176dd896e8ea7de7167'
  );
  
  console.log('Complete hash chain:');
  console.log('1. First entry hash:', firstChainHash);
  console.log('2. Second entry hash:', secondChainHash);
  console.log('3. Third entry hash:', thirdChainHash);
});

Deno.test('Edge case: empty data handling', async () => {
  const emptyData = new TextEncoder().encode('');
  const emptyBodyHash = await computeHash(emptyData);
  const emptyChainHash = await computeChainHash('', emptyData);
  
  assertEquals(
    emptyBodyHash,
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  
  // Chain hash of empty prior + empty body hash
  const emptyChainWithEmptyPrior = await computeChainHash('', emptyData);
  assertEquals(
    emptyChainWithEmptyPrior,
    'cd372fb85148700fa88095e3492d3f9f5beb43e555e5ff26d95f5a6adc36f8e6'
  );
});
