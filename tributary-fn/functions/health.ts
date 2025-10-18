// Health check endpoint
// GET /health

Deno.serve(async (_req: Request) => {
  return new Response(
    JSON.stringify({
      status: 'healthy',
      service: 'tributary-fn',
      timestamp: new Date().toISOString()
    }),
    { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
});
