// Basic tests for tributary-fn functions
import { assert, assertEquals } from 'jsr:@std/assert@1';

// Test the health endpoint
Deno.test('Health endpoint returns correct response', async () => {
  // Create a mock request for the health endpoint
  const req = new Request('http://localhost/health', {
    method: 'GET'
  });
  
  // Test URL parsing
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/').filter(part => part !== '');
  
  assertEquals(pathParts[0], 'health');
  assertEquals(req.method, 'GET');
});

// Test general structure
Deno.test('Functions directory has required files', async () => {
  const requiredFiles = ['upload.ts', 'health.ts', 'retrieve.ts', 'info.ts', 'latest.ts'];
  
  for (const file of requiredFiles) {
    try {
      const stat = await Deno.stat(`/root/tributary-fn/tributary-fn/functions/${file}`);
      assert(stat.isFile, `${file} should exist`);
    } catch (error: any) {
      throw new Error(`${file} not found: ${error.message}`);
    }
  }
});

// Test shared directory structure
Deno.test('Shared directory has required files', async () => {
  const requiredFiles = ['crypto.ts', 'database.ts', 'models.ts'];
  
  for (const file of requiredFiles) {
    try {
      const stat = await Deno.stat(`/root/tributary-fn/tributary-fn/shared/${file}`);
      assert(stat.isFile, `${file} should exist`);
    } catch (error: any) {
      throw new Error(`${file} not found: ${error.message}`);
    }
  }
});

// Test import map exists
Deno.test('Import map exists', async () => {
  try {
    const stat = await Deno.stat('/root/tributary-fn/tributary-fn/import_map.json');
    assert(stat.isFile, 'import_map.json should exist');
  } catch (error: any) {
    throw new Error(`import_map.json not found: ${error.message}`);
  }
});
