/**
 * Apache Arrow Serialization/Deserialization Tests
 * 
 * This test suite validates Apache Arrow IPC serialization/deserialization
 * patterns for blob data before implementing the full API route.
 * 
 * Tests demonstrate:
 * - Creating Arrow schemas for blob structure
 * - Building RecordBatches/Tables from blob data
 * - Serializing to Arrow IPC stream format
 * - Deserializing Arrow IPC streams back to usable data
 * - Handling binary data (Uint8Array) in Arrow columns
 */

import { assertEquals, assertExists, assertThrows } from 'jsr:@std/assert';
import { 
  tableFromArrays, 
  tableFromIPC, 
  tableToIPC,
  vectorFromArray,
  Binary,
  Utf8,
  Uint64
} from '@apache-arrow/ts';

/**
 * Blob data structure matching our database schema
 */
interface BlobData {
  seq: number;
  hash: string;
  prior_hash: string;
  data: Uint8Array;
}

/**
 * Helper function to create a table with explicit Arrow types
 * This ensures binary data is properly typed as Binary (not Struct)
 */
function createBlobTable(blobs: BlobData[]) {
  return tableFromArrays({
    seq: blobs.map(b => b.seq),
    hash: vectorFromArray(blobs.map(b => b.hash), new Utf8()),
    prior_hash: vectorFromArray(blobs.map(b => b.prior_hash), new Utf8()),
    data: vectorFromArray(blobs.map(b => b.data), new Binary())
  });
}

/**
 * Test 1: Create Arrow schema for blob data
 * 
 * Demonstrates that tableFromArrays can create the correct schema
 * with all required field types for blob data.
 */
Deno.test('Create Arrow schema for blob data', () => {
  // Create a simple table with our blob fields
  const table = tableFromArrays({
    seq: [1],
    hash: ['test-hash'],
    prior_hash: [''],
    data: [new Uint8Array([1, 2, 3])]
  });

  // Verify table was created
  assertExists(table);
  
  // Verify schema has correct fields
  const schema = table.schema;
  assertExists(schema);
  
  const fieldNames = schema.fields.map(f => f.name);
  assertEquals(fieldNames, ['seq', 'hash', 'prior_hash', 'data']);
  
  // Verify we have the expected number of rows
  assertEquals(table.numRows, 1);
  
  console.log('✓ Schema created with fields:', fieldNames);
  console.log('✓ Field types:', schema.fields.map(f => f.type.toString()));
});

/**
 * Test 2: Serialize single blob to Arrow IPC format
 * 
 * Demonstrates how to create a table from blob data and serialize
 * it to Arrow IPC stream format (returns Uint8Array).
 */
Deno.test('Serialize single blob to Arrow IPC format', () => {
  // Create test blob data with realistic hash format
  const testBlob: BlobData = {
    seq: 1,
    hash: 'sha256:a1b2c3d4e5f6g7h8i9j0',
    prior_hash: '',
    data: new TextEncoder().encode(JSON.stringify({
      id: 'txn-123',
      timestamp: Date.now(),
      query: 'INSERT INTO users VALUES ($1)',
      params: ['test']
    }))
  };

  // Build table from test data
  const table = tableFromArrays({
    seq: [testBlob.seq],
    hash: [testBlob.hash],
    prior_hash: [testBlob.prior_hash],
    data: [testBlob.data]
  });

  // Serialize to Arrow IPC stream format
  const ipcBytes = tableToIPC(table);

  // Assert serialization produces bytes
  assertExists(ipcBytes);
  assertEquals(ipcBytes instanceof Uint8Array, true);
  assertEquals(ipcBytes.byteLength > 0, true);

  console.log(`✓ Serialized ${table.numRows} blob(s) to ${ipcBytes.byteLength} bytes`);
});

/**
 * Test 3: Deserialize single blob from Arrow IPC format
 * 
 * Demonstrates how to deserialize an Arrow IPC stream and extract
 * the data back to objects, verifying all fields match.
 */
Deno.test('Deserialize single blob from Arrow IPC format', () => {
  // Create and serialize test blob
  const originalData = new Uint8Array([1, 2, 3, 4, 5]);
  const testBlob: BlobData = {
    seq: 42,
    hash: 'test-hash-value',
    prior_hash: '',
    data: originalData
  };

  const table = createBlobTable([testBlob]);
  const ipcBytes = tableToIPC(table);

  // Deserialize the Arrow IPC stream
  const deserializedTable = tableFromIPC(ipcBytes);

  // Assert table was deserialized
  assertExists(deserializedTable);
  assertEquals(deserializedTable.numRows, 1);

  // Extract data back to objects using .toJSON() for proper access
  const rows = [...deserializedTable].map(r => r.toJSON());
  assertEquals(rows.length, 1);

  const row = rows[0];
  
  // Assert all fields match original data
  assertEquals(row.seq, testBlob.seq);
  assertEquals(row.hash, testBlob.hash);
  assertEquals(row.prior_hash, testBlob.prior_hash);
  
  // Assert binary data is correctly preserved
  assertExists(row.data);
  assertEquals(row.data instanceof Uint8Array, true);
  assertEquals(row.data.length, originalData.length);
  
  // Verify byte-by-byte equality
  for (let i = 0; i < originalData.length; i++) {
    assertEquals(row.data[i], originalData[i], `Byte at index ${i} should match`);
  }

  console.log('✓ Deserialized blob matches original data');
  console.log(`✓ Binary data preserved: ${row.data.length} bytes`);
});

/**
 * Test 4: Serialize multiple blobs to Arrow IPC format
 * 
 * Demonstrates batching multiple blobs in a single RecordBatch/Table
 * and verifying the chain structure is preserved.
 */
Deno.test('Serialize multiple blobs to Arrow IPC format', () => {
  // Create test data with 3 blobs forming a chain
  const testBlobs: BlobData[] = [
    {
      seq: 1,
      hash: 'sha256:hash1',
      prior_hash: '',
      data: new Uint8Array([1, 2, 3])
    },
    {
      seq: 2,
      hash: 'sha256:hash2',
      prior_hash: 'sha256:hash1',
      data: new Uint8Array([4, 5, 6])
    },
    {
      seq: 3,
      hash: 'sha256:hash3',
      prior_hash: 'sha256:hash2',
      data: new Uint8Array([7, 8, 9])
    }
  ];

  // Build table with all blobs
  const table = tableFromArrays({
    seq: testBlobs.map(b => b.seq),
    hash: testBlobs.map(b => b.hash),
    prior_hash: testBlobs.map(b => b.prior_hash),
    data: testBlobs.map(b => b.data)
  });

  // Serialize to Arrow IPC format
  const ipcBytes = tableToIPC(table);

  // Assert correct number of rows
  assertEquals(table.numRows, 3);
  assertExists(ipcBytes);
  assertEquals(ipcBytes.byteLength > 0, true);

  console.log(`✓ Serialized ${table.numRows} blobs to ${ipcBytes.byteLength} bytes`);
});

/**
 * Test 5: Deserialize multiple blobs from Arrow IPC format
 * 
 * Demonstrates deserializing multiple blobs and verifying the chain
 * is preserved (prior_hash values correctly link blobs).
 */
Deno.test('Deserialize multiple blobs from Arrow IPC format', () => {
  // Create and serialize test blobs
  const testBlobs: BlobData[] = [
    {
      seq: 1,
      hash: 'hash1',
      prior_hash: '',
      data: new Uint8Array([1, 2, 3])
    },
    {
      seq: 2,
      hash: 'hash2',
      prior_hash: 'hash1',
      data: new Uint8Array([4, 5, 6])
    },
    {
      seq: 3,
      hash: 'hash3',
      prior_hash: 'hash2',
      data: new Uint8Array([7, 8, 9])
    }
  ];

  const table = createBlobTable(testBlobs);
  const ipcBytes = tableToIPC(table);

  // Deserialize Arrow IPC stream
  const deserializedTable = tableFromIPC(ipcBytes);

  // Extract all rows using .toJSON() for proper access
  const rows = [...deserializedTable].map(r => r.toJSON());

  // Assert we get back 3 blobs
  assertEquals(rows.length, 3);

  // Assert each blob has correct data
  for (let i = 0; i < testBlobs.length; i++) {
    const original = testBlobs[i];
    const deserialized = rows[i];

    assertEquals(deserialized.seq, original.seq);
    assertEquals(deserialized.hash, original.hash);
    assertEquals(deserialized.prior_hash, original.prior_hash);

    // Verify binary data
    assertEquals(deserialized.data.length, original.data.length);
    for (let j = 0; j < original.data.length; j++) {
      assertEquals(deserialized.data[j], original.data[j]);
    }
  }

  // Assert chain is preserved (prior_hash values)
  assertEquals(rows[0].prior_hash, '');
  assertEquals(rows[1].prior_hash, 'hash1');
  assertEquals(rows[2].prior_hash, 'hash2');

  console.log('✓ All 3 blobs deserialized correctly');
  console.log('✓ Chain structure preserved');
});

/**
 * Test 6: Handle various binary data sizes in Arrow
 * 
 * Tests serialization/deserialization with different data sizes:
 * - Empty data (0 bytes)
 * - Small data (10 bytes)
 * - Medium data (1 KB)
 * - Large data (1 MB)
 */
Deno.test('Handle various binary data sizes in Arrow', () => {
  const testCases = [
    { name: 'Empty', size: 0 },
    { name: 'Small', size: 10 },
    { name: 'Medium', size: 1024 }, // 1 KB
    { name: 'Large', size: 1024 * 1024 } // 1 MB
  ];

  for (const testCase of testCases) {
    // Create data of specific size
    const data = new Uint8Array(testCase.size);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 256; // Fill with pattern
    }

    // Serialize
    const blob: BlobData = {
      seq: 1,
      hash: 'test',
      prior_hash: '',
      data: data
    };
    const table = createBlobTable([blob]);
    const ipcBytes = tableToIPC(table);

    // Deserialize
    const deserializedTable = tableFromIPC(ipcBytes);
    const rows = [...deserializedTable].map(r => r.toJSON());

    // Assert binary data is preserved exactly
    assertEquals(rows[0].data.length, testCase.size);
    
    if (testCase.size > 0) {
      for (let i = 0; i < data.length; i++) {
        assertEquals(
          rows[0].data[i],
          data[i],
          `Byte ${i} mismatch for ${testCase.name} (${testCase.size} bytes)`
        );
      }
    }

    console.log(`✓ ${testCase.name} (${testCase.size} bytes) preserved correctly`);
  }
});

/**
 * Test 7: Round-trip serialization preserves all data
 * 
 * Complex test with various data patterns to ensure complete
 * byte-for-byte equality after round-trip serialization.
 */
Deno.test('Round-trip serialization preserves all data', () => {
  // Create complex test data
  const complexBlobs: BlobData[] = [
    {
      seq: 1,
      hash: 'sha256:' + 'a'.repeat(64), // Long hash
      prior_hash: '',
      data: new Uint8Array([0, 255, 128, 1, 254]) // Various byte patterns
    },
    {
      seq: 999999,
      hash: 'sha256:' + 'b'.repeat(64),
      prior_hash: 'sha256:' + 'a'.repeat(64),
      data: new Uint8Array(100).fill(42) // Repeated pattern
    },
    {
      seq: 1000000,
      hash: 'sha256:unicode-test-🚀-✨',
      prior_hash: 'sha256:' + 'b'.repeat(64),
      data: new TextEncoder().encode('Test with unicode: 日本語 🎉')
    }
  ];

  // Serialize
  const table = createBlobTable(complexBlobs);
  const ipcBytes = tableToIPC(table);

  // Deserialize
  const deserializedTable = tableFromIPC(ipcBytes);
  const rows = [...deserializedTable].map(r => r.toJSON());

  // Assert byte-for-byte equality of all fields
  assertEquals(rows.length, complexBlobs.length);

  for (let i = 0; i < complexBlobs.length; i++) {
    const original = complexBlobs[i];
    const deserialized = rows[i];

    // Verify all fields
    assertEquals(deserialized.seq, original.seq, `seq mismatch at index ${i}`);
    assertEquals(deserialized.hash, original.hash, `hash mismatch at index ${i}`);
    assertEquals(deserialized.prior_hash, original.prior_hash, `prior_hash mismatch at index ${i}`);

    // Verify binary data byte-for-byte
    assertEquals(deserialized.data.length, original.data.length, `data length mismatch at index ${i}`);
    for (let j = 0; j < original.data.length; j++) {
      assertEquals(
        deserialized.data[j],
        original.data[j],
        `data byte ${j} mismatch at index ${i}`
      );
    }
  }

  console.log('✓ Round-trip serialization preserves all data exactly');
  console.log(`✓ Tested ${complexBlobs.length} blobs with various patterns`);
});

/**
 * Test 8: Handle malformed Arrow data gracefully
 * 
 * Tests error handling for various invalid inputs:
 * - Empty buffer
 * - Truncated Arrow stream
 * - Invalid data
 */
Deno.test('Handle malformed Arrow data gracefully', () => {
  // Test 1: Empty buffer - Arrow handles this gracefully (returns empty table)
  const emptyTable = tableFromIPC(new Uint8Array(0));
  assertEquals(emptyTable.numRows, 0);
  console.log('✓ Empty buffer handled gracefully (returns empty table)');

  // Test 2: Random bytes - Arrow handles this gracefully too (returns empty table)
  const randomTable = tableFromIPC(new Uint8Array([1, 2, 3, 4, 5]));
  assertEquals(randomTable.numRows, 0);
  console.log('✓ Random bytes handled gracefully (returns empty table)');

  // Test 3: Truncated Arrow data - Arrow throws error on truncated data
  assertThrows(
    () => {
      const table = createBlobTable([{
        seq: 1,
        hash: 'test',
        prior_hash: '',
        data: new Uint8Array([1, 2, 3])
      }]);
      const validBytes = tableToIPC(table);
      
      // Truncate to just the first 10 bytes
      const truncated = validBytes.slice(0, 10);
      tableFromIPC(truncated);
    },
    Error,
    undefined,
    'Should throw error on truncated Arrow data'
  );
  console.log('✓ Truncated data throws error as expected');
  
  console.log('✓ Arrow library handles invalid/empty data gracefully, but throws on corrupted data');
});

/**
 * Bonus Test: Verify empty result sets work correctly
 * 
 * Ensures we can handle the case of 0 blobs (empty result set).
 */
Deno.test('Handle empty result set (0 blobs)', () => {
  // Create table with 0 rows but correct schema
  const table = tableFromArrays({
    seq: [],
    hash: [],
    prior_hash: [],
    data: []
  });

  assertEquals(table.numRows, 0);

  // Serialize empty table
  const ipcBytes = tableToIPC(table);
  assertExists(ipcBytes);

  // Deserialize
  const deserializedTable = tableFromIPC(ipcBytes);
  assertEquals(deserializedTable.numRows, 0);

  const rows = [...deserializedTable];
  assertEquals(rows.length, 0);

  console.log('✓ Empty result set (0 blobs) handled correctly');
});

/**
 * Bonus Test: Demonstrate table iteration patterns
 * 
 * Shows different ways to access row data from Arrow tables.
 */
Deno.test('Demonstrate table iteration patterns', () => {
  const testBlobs: BlobData[] = [
    { seq: 1, hash: 'h1', prior_hash: '', data: new Uint8Array([1]) },
    { seq: 2, hash: 'h2', prior_hash: 'h1', data: new Uint8Array([2]) },
    { seq: 3, hash: 'h3', prior_hash: 'h2', data: new Uint8Array([3]) }
  ];

  const table = tableFromArrays({
    seq: testBlobs.map(b => b.seq),
    hash: testBlobs.map(b => b.hash),
    prior_hash: testBlobs.map(b => b.prior_hash),
    data: testBlobs.map(b => b.data)
  });

  // Pattern 1: Spread operator
  const rows1 = [...table];
  assertEquals(rows1.length, 3);

  // Pattern 2: for...of loop with .toJSON()
  let count = 0;
  for (const row of table) {
    const jsonRow = row.toJSON();
    assertExists(jsonRow.seq);
    assertExists(jsonRow.hash);
    count++;
  }
  assertEquals(count, 3);

  // Pattern 3: toArray()
  const rows3 = table.toArray();
  assertEquals(rows3.length, 3);

  // Pattern 4: Access specific row by index with .toJSON()
  const row = table.get(0);
  assertExists(row);
  // deno-lint-ignore no-explicit-any
  const jsonRow = (row as any).toJSON();
  assertEquals(jsonRow.seq, 1);

  console.log('✓ All iteration patterns work correctly');
  console.log('  - Spread operator: [...table]');
  console.log('  - for...of loop: for (const row of table)');
  console.log('  - toArray(): table.toArray()');
  console.log('  - Index access: table.get(index)');
});
