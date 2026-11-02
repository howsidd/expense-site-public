// Errors the page hits on your phone or laptop (the reporter at the top of index.html) go to the hdfc-sync Worker, which
// keeps the last 20 and raises them in its health check: the banner here and the iPhone's morning alert (TODO.md, A3).
// Behind the site password like every /api route. Always answers 204, so a report can never cause another error.
export async function onRequestPost({ request, env }) {
  if (env.HEALTH_TOKEN && env.WORKER_URL) {
    const body = (await request.text()).slice(0, 2000);
    await fetch(env.WORKER_URL + '/report', { method: 'POST', body,
      headers: { 'X-Sync-Token': env.HEALTH_TOKEN, 'Content-Type': 'application/json' } }).catch(() => {});
  }
  return new Response(null, { status: 204 });
}
