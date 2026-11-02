// Password gate for the whole site: pages, scripts and /api/*. One password, set as the SITE_PASSWORD secret in
// Cloudflare (Pages → expense-site → Settings → Variables and Secrets). Until it's set the site stays open as before.
// A correct password gets a signed cookie for 30 days. Changing the password signs every device out.

const COOKIE = 'session';
const DAYS = 30;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
// Compare every character so the time taken doesn't hint at how much matched.
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

async function signedIn(request, secret) {
  const m = (request.headers.get('Cookie') || '').match(/(?:^|;\s*)session=([^;]+)/);
  const [exp, sig] = (m ? m[1] : '').split('.');
  return !!exp && !!sig && Number(exp) > Date.now() && same(await sign(secret, exp), sig);
}

const page = (error, status) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>₹ Dashboard</title><meta name="robots" content="noindex"><style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:#F7F7F5;color:#37352F;font:15px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
form{width:min(360px,100%);background:#fff;border:1px solid #E9E9E7;border-radius:20px;padding:28px;display:flex;flex-direction:column;gap:14px;box-shadow:0 20px 56px -24px rgba(15,15,15,.18)}
.logo{width:44px;height:44px;border-radius:12px;background:#191919;color:#fff;display:grid;place-items:center;font-weight:600;font-size:18px}
h1{margin:4px 0 0;font-size:22px;letter-spacing:-.03em;color:#191919}p{margin:0;color:#787774;font-size:13.5px}
input{width:100%;height:46px;padding:0 14px;border-radius:12px;border:1.5px solid transparent;background:#F7F7F5;font:inherit;font-size:16px;outline:0}input:focus{border-color:#191919;background:#fff}
button{height:46px;border:0;border-radius:12px;background:#191919;color:#fff;font:inherit;font-weight:600;cursor:pointer}button:active{transform:scale(.98)}
.err{color:#E5484D;font-size:13.5px}</style></head><body>
<form method="post" action="/login"><div class="logo" aria-hidden="true">₹</div><h1>Your dashboard is locked</h1><p>Enter your password to open it. This device stays signed in for ${DAYS} days.</p>
${error ? `<div class="err" role="alert">${error}</div>` : ''}<input type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required autofocus>
<button>Unlock</button></form></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

// The site lives at this address; Cloudflare's own *.pages.dev addresses would be a way around its login.
// Set SITE_URL (e.g. https://finance.example.com) to send *.pages.dev visitors there.

export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (env.SITE_URL && url.hostname.endsWith('.pages.dev')) return Response.redirect(env.SITE_URL + url.pathname + url.search, 302);
  const password = env.SITE_PASSWORD;
  if (!password) return next();
  const secret = env.SESSION_SECRET || password;
  const { pathname } = url;

  if (pathname === '/logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (pathname === '/login' && request.method === 'POST') {
    const given = String((await request.formData().catch(() => null))?.get('password') || '');
    // Compare signatures of both passwords so a wrong guess takes as long as a right one.
    if (!same(await sign(secret, 'pw:' + given), await sign(secret, 'pw:' + password))) {
      // ponytail: a fixed pause slows guessing from one connection; add a rate limit if this ever gets hammered.
      await new Promise((r) => setTimeout(r, 1000));
      return page('That password isn’t right.', 401);
    }
    const exp = String(Date.now() + DAYS * 864e5);
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=${exp}.${await sign(secret, exp)}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Lax` } });
  }
  if (await signedIn(request, secret)) return next();
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ ok: false, error: 'signed out' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  return page('', 401);
}
