// Retired client endpoint. Redeploy this handler to disable old deployments.
Deno.serve(() => new Response(JSON.stringify({ error: 'Client access has been retired. Please contact the atelier.' }), {
  status: 410,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
}));
