// Unit tests for database functions
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { Database } from '../../shared/database.ts';
import { Blob, BlobMetadata, CollectionInfo } from '../../shared/models.ts';

// Mock Supabase client for testing
class MockSupabaseClient {
  private data: any[] = [];
  
  from(table: string) {
    return this;
  }
  
  select(columns: string = '*') {
    return this;
  }
  
  eq(column: string, value: any) {
    return this;
  }
  
  single() {
    return this;
  }
  
  upsert(data: any, options: any = {}) {
    return { error: null };
  }
  
  order(column: string, options: any = {}) {
    return this;
  }
  
  limit(count: number) {
    return this;
  }
  
  async execute() {
    return { error: null };
  }
}

// Override the Supabase client with a mock for testing
// We'll need to refactor the Database class to accept a client for better testability

Deno.test('Database class structure', () => {
  // This is a basic structural test since we can't easily mock Supabase in unit tests
  const db = new Database();
  assert(db instanceof Database);
  assert(typeof db.storeBlob === 'function');
  assert(typeof db.retrieveBlob === 'function');
  assert(typeof db.getBlobMetadata === 'function');
  assert(typeof db.getLatestBlob === 'function');
  assert(typeof db.getCollectionInfo === 'function');
});

Deno.test('Database functions exist', async () => {
  const functions = [
    'storeBlob',
    'retrieveBlob', 
    'getBlobMetadata',
    'getLatestBlob',
    'getCollectionInfo'
  ];
  
  for (const func of functions) {
    assertEquals(typeof (new Database() as any)[func], 'function', `${func} should be a function`);
  }
});
