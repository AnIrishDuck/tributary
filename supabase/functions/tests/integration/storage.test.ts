// Integration tests for the storage config endpoint
import { assertEquals } from 'jsr:@std/assert@1';
import { createStorageHandler, StorageConfigDb, StorageAuthenticator } from '../../storage/index.ts';

// Fake in-memory storage config database
function createFakeStorageDb(): StorageConfigDb {
  const store = new Map<string, string>();
  return {
    async getServerUrl(userId: string): Promise<string | null> {
      return store.get(userId) ?? null;
    },
    async setServerUrl(userId: string, serverUrl: string): Promise<void> {
      store.set(userId, serverUrl);
    },
    async deleteServerUrl(userId: string): Promise<void> {
      store.delete(userId);
    },
  };
}

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const fakeAuth: StorageAuthenticator = async (_req) => ({ id: TEST_USER_ID });
const failAuth: StorageAuthenticator = async (_req) => null;

function makeRequest(method: string, body?: unknown, auth = true): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = 'Bearer fake-token';
  return new Request('http://localhost/functions/v1/storage', {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

Deno.test('Storage config: GET returns null when no config exists', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);
  const response = await handler(makeRequest('GET'));

  assertEquals(response.status, 200);
  const result = await response.json();
  assertEquals(result.server_url, null);
});

Deno.test('Storage config: PUT sets server URL', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const putResponse = await handler(makeRequest('PUT', { server_url: 'https://my-server.example.com/stream' }));
  assertEquals(putResponse.status, 200);
  const putResult = await putResponse.json();
  assertEquals(putResult.server_url, 'https://my-server.example.com/stream');

  // Verify GET returns the saved URL
  const getResponse = await handler(makeRequest('GET'));
  assertEquals(getResponse.status, 200);
  const getResult = await getResponse.json();
  assertEquals(getResult.server_url, 'https://my-server.example.com/stream');
});

Deno.test('Storage config: PUT overwrites existing URL', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  await handler(makeRequest('PUT', { server_url: 'https://old-server.example.com' }));
  await handler(makeRequest('PUT', { server_url: 'https://new-server.example.com' }));

  const response = await handler(makeRequest('GET'));
  const result = await response.json();
  assertEquals(result.server_url, 'https://new-server.example.com');
});

Deno.test('Storage config: DELETE removes config', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  // Set a URL
  await handler(makeRequest('PUT', { server_url: 'https://my-server.example.com' }));

  // Delete it
  const delResponse = await handler(makeRequest('DELETE'));
  assertEquals(delResponse.status, 200);
  const delResult = await delResponse.json();
  assertEquals(delResult.server_url, null);

  // Verify it's gone
  const getResponse = await handler(makeRequest('GET'));
  const getResult = await getResponse.json();
  assertEquals(getResult.server_url, null);
});

Deno.test('Storage config: rejects unauthenticated requests', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), failAuth);

  const response = await handler(makeRequest('GET'));
  assertEquals(response.status, 401);
});

Deno.test('Storage config: PUT rejects invalid URL', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const response = await handler(makeRequest('PUT', { server_url: 'not-a-valid-url' }));
  assertEquals(response.status, 400);
  const result = await response.json();
  assertEquals(result.error, 'Invalid URL format');
});

Deno.test('Storage config: PUT rejects missing server_url', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const response = await handler(makeRequest('PUT', { something_else: 'foo' }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, 'server_url is required');
});

Deno.test('Storage config: PUT rejects non-string server_url', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const response = await handler(makeRequest('PUT', { server_url: 123 }));
  assertEquals(response.status, 400);
});

Deno.test('Storage config: PUT rejects invalid JSON body', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const req = new Request('http://localhost/functions/v1/storage', {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer fake', 'Content-Type': 'application/json' },
    body: 'not json',
  });
  const response = await handler(req);
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error, 'Invalid JSON body');
});

Deno.test('Storage config: OPTIONS returns CORS preflight', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const response = await handler(makeRequest('OPTIONS'));
  assertEquals(response.status, 204);
});

Deno.test('Storage config: unsupported method returns 405', async () => {
  const handler = createStorageHandler(createFakeStorageDb(), fakeAuth);

  const req = new Request('http://localhost/functions/v1/storage', {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer fake' },
  });
  const response = await handler(req);
  assertEquals(response.status, 405);
});

Deno.test('Storage config: different users have isolated configs', async () => {
  const db = createFakeStorageDb();
  const userA = 'aaaa-aaaa';
  const userB = 'bbbb-bbbb';

  const handlerA = createStorageHandler(db, async () => ({ id: userA }));
  const handlerB = createStorageHandler(db, async () => ({ id: userB }));

  await handlerA(makeRequest('PUT', { server_url: 'https://server-a.example.com' }));
  await handlerB(makeRequest('PUT', { server_url: 'https://server-b.example.com' }));

  const resultA = await (await handlerA(makeRequest('GET'))).json();
  const resultB = await (await handlerB(makeRequest('GET'))).json();

  assertEquals(resultA.server_url, 'https://server-a.example.com');
  assertEquals(resultB.server_url, 'https://server-b.example.com');
});
