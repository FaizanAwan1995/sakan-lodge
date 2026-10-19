import { databaseRpc, json, limitedJson } from './public-site.js';
import { validateReview } from './reviews.js';
export const reviewsEnabled = env => !!(env.SUPABASE_URL && env.SUPABASE_PUBLIC_KEY && (env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
export async function reviewsApi(request, env) {
  if (request.method === 'GET') {
    try { return json({ reviews: await databaseRpc(env, 'published_testimonials') }); }
    catch { return json({ error: 'Reviews are temporarily unavailable.' }, 503); }
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (request.headers.get('Origin') !== 'https://sakanlodge.com' || new URL(request.url).hostname !== 'sakanlodge.com') return json({ error: 'Invalid origin' }, 403);
  if (!reviewsEnabled(env)) return json({ error: 'Review submission is temporarily unavailable.' }, 503);
  let input, data;
  const key = request.headers.get('Idempotency-Key');
  try {
    input = await limitedJson(request, 10000);
    data = validateReview(input);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '') || typeof input.turnstile_token !== 'string' || !input.turnstile_token || input.turnstile_token.length > 2048) throw Error('Please complete the verification.');
  } catch (e) { return json({ error: e.message === 'Request too large' ? 'Review is too large.' : 'Check your details, publishing consent and verification.' }, 400); }
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: input.turnstile_token, remoteip: request.headers.get('CF-Connecting-IP') || '', idempotency_key: key }), signal: AbortSignal.timeout(8000) });
    const verified = await response.json();
    if (!response.ok || !verified.success || verified.hostname !== 'sakanlodge.com' || verified.action !== 'review') return json({ error: 'Verification failed. Please try again.' }, 400);
    const bytes = new TextEncoder().encode(env.TURNSTILE_SECRET_KEY + ':' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
    const fingerprint = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2,'0')).join('');
    await databaseRpc(env, 'submit_testimonial', { p_data: data, p_key: key, p_fingerprint: fingerprint }, { admin: true });
    return json({ received: true, message: 'Thank you! Your review has been received and will be checked by our team before publication.' }, 202);
  } catch (e) {
    const status = [400,409,429].includes(e.status) ? e.status : 503;
    return json({ error: {400:'Check your review details.',409:'This request changed. Refresh the page before submitting again.',429:'A review was recently submitted. Please try again later.',503:'We could not confirm receipt. Keep your review and retry with the same request.'}[status] }, status);
  }
}
