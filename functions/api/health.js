// The banner under every page's title when something has stopped (TODO.md, A2): asks the hdfc-sync Worker's /health
// from here, so its key (HEALTH_TOKEN, a Pages secret) never reaches the browser. The Worker keeps its answer for an
// hour. Behind the site password like every /api route. Answers { problems: ["Bank sync: not working for ...", ...] }.


export async function onRequestGet({ env }) {
  if (!env.HEALTH_TOKEN || !env.WORKER_URL) return Response.json({ problems: [] }); // not set up: no banner
  try {
    const r = await fetch(env.WORKER_URL + '/health', { headers: { 'X-Sync-Token': env.HEALTH_TOKEN } });
    if (r.status === 204) return Response.json({ problems: [] });
    if (!r.ok) return Response.json({ problems: [`Sync Worker: it answered ${r.status}. Look at Cloudflare → Workers → hdfc-sync → Logs.`] });
    return Response.json({ problems: (await r.text()).split('\n\n').filter(Boolean) });
  } catch (e) {
    return Response.json({ problems: [`Sync Worker: it can't be reached (${String(e.message || e).slice(0, 80)}).`] });
  }
}
