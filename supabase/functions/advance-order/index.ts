// Retire the automatic Hubtel sender. Staff advance through the database RPC.
Deno.serve(() => new Response(JSON.stringify({ error: 'Automatic SMS is disabled. Update the staff app and record SMS manually.' }), {
  status: 410, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
}));
