// Server-side Gmail sending endpoint.
export async function gmailSend(request, env) {
  return new Response(JSON.stringify({ error: 'Sending is not configured yet.' }), { status: 503, headers: { 'content-type': 'application/json' } });
}
