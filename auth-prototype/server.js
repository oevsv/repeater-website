#!/usr/bin/env node
'use strict';
/*
 * OIDC Authorization Code + PKCE prototype for repeater.oevsv.at
 * ----------------------------------------------------------------
 * A tiny, zero-dependency Node server (Node >= 20) that handles the
 * server-side half of the login flow for the CONFIDENTIAL Keycloak client
 * `oevsv.repeater`. The client secret and the token exchange stay here, on
 * the server — they never reach the browser.
 *
 * Routes (nginx proxies these three paths to this process):
 *   GET /login       -> redirect to Keycloak, starting the Auth Code + PKCE flow
 *   GET /authorized  -> OAuth callback: exchange code for tokens, show the claims
 *   GET /logout      -> clear the session and RP-initiated logout at Keycloak
 *
 * Configuration is via environment variables ONLY (see .env.example). No
 * secret is baked into this file or committed to the repo.
 */

const http = require('http');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Config (env only).
// ---------------------------------------------------------------------------
const cfg = {
  issuer:       env('OIDC_ISSUER', 'https://id.oevsv.at/realms/oevsv'),
  clientId:     env('OIDC_CLIENT_ID', 'oevsv.repeater'),
  clientSecret: env('OIDC_CLIENT_SECRET'),                       // REQUIRED, no default
  redirectUri:  env('OIDC_REDIRECT_URI', 'https://repeater.oevsv.at/authorized'),
  postLogoutUri:env('OIDC_POST_LOGOUT_URI', 'https://repeater.oevsv.at/'),
  scope:        env('OIDC_SCOPE', 'openid profile email'),
  port:         parseInt(env('PORT', '8780'), 10),
  // HMAC key for signing the transient + session cookies. Set a stable value
  // in production so sessions survive restarts; random fallback for dev.
  cookieSecret: env('COOKIE_SECRET', crypto.randomBytes(32).toString('hex')),
  cookieSecure: env('COOKIE_SECURE', 'true') !== 'false',       // Secure flag on cookies

  // --- BFF proxy for /api/secure -> PostgREST ---
  pgrstUpstream:  env('PGRST_UPSTREAM', 'http://127.0.0.1:3000'),
  pgrstJwtSecret: env('PGRST_JWT_SECRET'),       // shared with PostgREST's jwt-secret
  pgrstRole:      env('PGRST_ROLE', 'web_user'), // Postgres role the minted token maps to
  pgrstTokenTtl:  parseInt(env('PGRST_TOKEN_TTL', '30'), 10), // seconds; mint fresh per request
  // If set (e.g. "/api/secure"), this prefix is stripped before forwarding, so
  // /api/secure/whoami -> PostgREST /whoami (PostgREST serves tables at root).
  // Leave empty to forward the path unchanged.
  pgrstStripPrefix: env('PGRST_STRIP_PREFIX', ''),
};

if (!cfg.clientSecret) {
  console.error('FATAL: OIDC_CLIENT_SECRET is not set. Refusing to start.');
  process.exit(1);
}
if (!process.env.COOKIE_SECRET) {
  console.warn('WARN: COOKIE_SECRET not set — using a random key; sessions will not survive a restart.');
}

const endpoints = {
  auth:    `${cfg.issuer}/protocol/openid-connect/auth`,
  token:   `${cfg.issuer}/protocol/openid-connect/token`,
  jwks:    `${cfg.issuer}/protocol/openid-connect/certs`,
  logout:  `${cfg.issuer}/protocol/openid-connect/logout`,
};

function env(name, dflt) {
  const v = process.env[name];
  return (v === undefined || v === '') ? dflt : v;
}

// ---------------------------------------------------------------------------
// Small helpers: base64url, HMAC-signed cookie values.
// ---------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(value) {
  const mac = crypto.createHmac('sha256', cfg.cookieSecret).update(value).digest('base64url');
  return `${value}.${mac}`;
}
function unsign(signed) {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const mac = signed.slice(i + 1);
  const expected = crypto.createHmac('sha256', cfg.cookieSecret).update(value).digest('base64url');
  // constant-time compare
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
function packCookie(obj) { return sign(b64url(JSON.stringify(obj))); }
function unpackCookie(signed) {
  const v = unsign(signed);
  if (!v) return null;
  try { return JSON.parse(Buffer.from(v, 'base64url').toString('utf8')); }
  catch { return null; }
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, { maxAge, clear } = {}) {
  const attrs = [`${name}=${clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (cfg.cookieSecure) attrs.push('Secure');
  if (clear) attrs.push('Max-Age=0');
  else if (maxAge) attrs.push(`Max-Age=${maxAge}`);
  appendHeader(res, 'Set-Cookie', attrs.join('; '));
}
function appendHeader(res, name, value) {
  const prev = res.getHeader(name);
  if (!prev) res.setHeader(name, value);
  else res.setHeader(name, Array.isArray(prev) ? prev.concat(value) : [prev, value]);
}

// ---------------------------------------------------------------------------
// JWKS fetch + cache, and RS256/PS* id_token verification (built-in crypto).
// ---------------------------------------------------------------------------
let jwksCache = { keys: [], at: 0 };
async function getKey(kid) {
  const fresh = Date.now() - jwksCache.at < 10 * 60 * 1000;
  let jwk = jwksCache.keys.find((k) => k.kid === kid);
  if (!jwk || !fresh) {
    const r = await fetch(endpoints.jwks);
    if (!r.ok) throw new Error(`JWKS fetch failed: ${r.status}`);
    jwksCache = { keys: (await r.json()).keys || [], at: Date.now() };
    jwk = jwksCache.keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error(`no JWKS key for kid=${kid}`);
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
}

const ALG = {
  RS256: { algorithm: 'RSA-SHA256' },
  RS384: { algorithm: 'RSA-SHA384' },
  RS512: { algorithm: 'RSA-SHA512' },
  PS256: { algorithm: 'RSA-SHA256', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
  PS384: { algorithm: 'RSA-SHA384', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
  PS512: { algorithm: 'RSA-SHA512', padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
};

async function verifyIdToken(idToken, { nonce }) {
  const [h, p, s] = idToken.split('.');
  if (!h || !p || !s) throw new Error('malformed id_token');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));

  const spec = ALG[header.alg];
  if (!spec) throw new Error(`unsupported alg ${header.alg}`);
  const pub = await getKey(header.kid);
  const ok = crypto.verify(
    spec.algorithm,
    Buffer.from(`${h}.${p}`),
    { key: pub, padding: spec.padding, saltLength: spec.saltLength },
    Buffer.from(s, 'base64url'),
  );
  if (!ok) throw new Error('id_token signature invalid');

  // Standard OIDC claim checks.
  if (claims.iss !== cfg.issuer) throw new Error(`iss mismatch: ${claims.iss}`);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) throw new Error(`aud mismatch: ${claims.aud}`);
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && now > claims.exp + 60) throw new Error('id_token expired');
  if (nonce && claims.nonce !== nonce) throw new Error('nonce mismatch');
  return claims;
}

// ---------------------------------------------------------------------------
// Mint a short-lived HS256 JWT for PostgREST, carrying the Postgres role plus
// the identity claims. PostgREST verifies the HMAC with the shared secret and
// exposes the claims to SQL via current_setting('request.jwt.claims', true).
// ---------------------------------------------------------------------------
function mintPgrstToken(session) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    role: cfg.pgrstRole,
    callsign: session.callsign,     // preferred_username
    name: session.name,
    email: session.email,
    sub: session.sub,
    iat: now,
    exp: now + cfg.pgrstTokenTtl,
  };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha256', cfg.pgrstJwtSecret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

// BFF: /api/secure/* — authenticated passthrough to PostgREST with an injected,
// signed identity token. Requires a logged-in session (it is "secure").
async function handleApiSecure(req, res, url) {
  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  if (!cfg.pgrstJwtSecret) return json(503, { error: 'PGRST_JWT_SECRET not configured on the auth service' });

  const session = unpackCookie(parseCookies(req).oidc_session);
  if (!session) return json(401, { error: 'authentication required' });

  // Map the path toward PostgREST (optionally stripping the /api/secure prefix).
  let path = url.pathname;
  if (cfg.pgrstStripPrefix && path.startsWith(cfg.pgrstStripPrefix)) {
    path = path.slice(cfg.pgrstStripPrefix.length) || '/';
  }
  const upstream = cfg.pgrstUpstream.replace(/\/$/, '') + path + url.search;

  // Forward a safe subset of request headers; strip anything auth/host/cookie
  // related and inject our minted bearer token.
  const fwd = new Headers();
  for (const h of ['content-type', 'accept', 'accept-profile', 'content-profile', 'prefer', 'range', 'range-unit']) {
    const v = req.headers[h];
    if (v) fwd.set(h, Array.isArray(v) ? v.join(',') : v);
  }
  fwd.set('Authorization', `Bearer ${mintPgrstToken(session)}`);

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE';
  const body = hasBody ? await readBody(req) : undefined;

  let upstreamResp;
  try {
    upstreamResp = await fetch(upstream, {
      method: req.method,
      headers: fwd,
      body: body && body.length ? body : undefined,
    });
  } catch (e) {
    return json(502, { error: 'PostgREST upstream unreachable', detail: e.message });
  }

  // Relay status + a safe set of response headers (skip hop-by-hop).
  const outHeaders = { 'Cache-Control': 'no-store' };
  for (const [k, v] of upstreamResp.headers) {
    if (['transfer-encoding', 'connection', 'keep-alive', 'content-encoding', 'content-length'].includes(k)) continue;
    outHeaders[k] = v;
  }
  const buf = Buffer.from(await upstreamResp.arrayBuffer());
  res.writeHead(upstreamResp.status, outHeaders);
  res.end(buf);
}

// Only allow redirecting back to a local path (no open redirect to other sites).
function safeReturnTo(raw) {
  if (!raw || typeof raw !== 'string') return '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  return raw;
}

async function handleLogin(req, res) {
  const inUrl = new URL(req.url, 'http://localhost');
  const returnTo = safeReturnTo(inUrl.searchParams.get('returnTo'));

  const state = b64url(crypto.randomBytes(16));
  const nonce = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());

  // Stash the transient flow data (incl. where to return) in a short-lived signed cookie.
  setCookie(res, 'oidc_tx', packCookie({ state, nonce, verifier, returnTo }), { maxAge: 600 });

  const url = new URL(endpoints.auth);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();

  res.writeHead(302, { Location: url.toString() });
  res.end();
}

async function handleAuthorized(req, res, query) {
  if (query.get('error')) {
    return page(res, 400, 'Login failed',
      `<p class="err">Keycloak returned an error: <code>${esc(query.get('error'))}</code></p>
       <p>${esc(query.get('error_description') || '')}</p><p><a href="/login">Try again</a></p>`);
  }

  const tx = unpackCookie(parseCookies(req).oidc_tx);
  if (!tx) return page(res, 400, 'Login failed', `<p class="err">Missing or invalid login session. <a href="/login">Start over</a>.</p>`);
  setCookie(res, 'oidc_tx', '', { clear: true });

  if (query.get('state') !== tx.state) {
    return page(res, 400, 'Login failed', `<p class="err">State mismatch (possible CSRF). <a href="/login">Start over</a>.</p>`);
  }
  const code = query.get('code');
  if (!code) return page(res, 400, 'Login failed', `<p class="err">No authorization code returned.</p>`);

  // Token exchange — server to server, with the client secret.
  const tokenResp = await fetch(endpoints.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: tx.verifier,
    }),
  });
  const tokens = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok) {
    return page(res, 502, 'Login failed',
      `<p class="err">Token exchange failed (HTTP ${tokenResp.status}): <code>${esc(tokens.error || '')}</code></p>
       <p>${esc(tokens.error_description || '')}</p>`);
  }

  let claims;
  try {
    claims = await verifyIdToken(tokens.id_token, { nonce: tx.nonce });
  } catch (e) {
    return page(res, 502, 'Login failed', `<p class="err">id_token verification failed: ${esc(e.message)}</p>`);
  }

  // Minimal prototype session: store a few claims + the id_token (for logout hint).
  setCookie(res, 'oidc_session', packCookie({
    sub: claims.sub,
    name: claims.name,
    email: claims.email,
    email_verified: claims.email_verified,
    callsign: claims.preferred_username,
    id_token: tokens.id_token,
  }), { maxAge: 3600 });

  // Success: go back into the SPA (where the login widget shows the identity),
  // not to a server-rendered page.
  res.writeHead(302, { Location: safeReturnTo(tx.returnTo), 'Cache-Control': 'no-store' });
  res.end();
}

async function handleMe(req, res) {
  const session = unpackCookie(parseCookies(req).oidc_session);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (!session) {
    res.writeHead(401, headers);
    return res.end(JSON.stringify({ authenticated: false }));
  }
  // Only display-safe claims — never the id_token / any token.
  res.writeHead(200, headers);
  res.end(JSON.stringify({
    authenticated: true,
    callsign: session.callsign,
    name: session.name,
    email: session.email,
    email_verified: session.email_verified,
    sub: session.sub,
  }));
}

async function handleLogout(req, res) {
  const session = unpackCookie(parseCookies(req).oidc_session);
  setCookie(res, 'oidc_session', '', { clear: true });

  const url = new URL(endpoints.logout);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('post_logout_redirect_uri', cfg.postLogoutUri);
  if (session && session.id_token) url.searchParams.set('id_token_hint', session.id_token);

  res.writeHead(302, { Location: url.toString() });
  res.end();
}

// ---------------------------------------------------------------------------
// HTML helpers + server.
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function page(res, status, title, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · repeater.oevsv.at</title>
<style>
  :root{color-scheme:light dark;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  body{max-width:42rem;margin:3rem auto;padding:0 1rem;line-height:1.5}
  h1{font-size:1.4rem} table{border-collapse:collapse;margin:1rem 0;width:100%}
  th,td{text-align:left;padding:.4rem .6rem;border-bottom:1px solid #8884;vertical-align:top}
  th{white-space:nowrap;width:16rem} code,pre{font-family:ui-monospace,monospace}
  pre{background:#8881;padding:1rem;border-radius:.5rem;overflow:auto}
  .ok{color:#137333;font-weight:600}.err{color:#c5221f;font-weight:600}
  .btn{display:inline-block;padding:.5rem 1rem;background:#1a73e8;color:#fff;border-radius:.4rem;text-decoration:none}
  details{margin-top:1rem}
</style></head><body>
<h1>${esc(title)}</h1>
${body}
</body></html>`);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');

    // BFF proxy: all HTTP methods (PostgREST needs POST/PATCH/DELETE).
    if (u.pathname === '/api/secure' || u.pathname.startsWith('/api/secure/')) {
      return await handleApiSecure(req, res, u);
    }

    // Everything else is GET-only.
    if (req.method !== 'GET') { res.writeHead(405); return res.end('Method Not Allowed'); }
    switch (u.pathname) {
      case '/login':      return await handleLogin(req, res);
      case '/authorized': return await handleAuthorized(req, res, u.searchParams);
      case '/me':         return await handleMe(req, res);
      case '/logout':     return await handleLogout(req, res);
      case '/healthz':    res.writeHead(200); return res.end('ok');
      default:            res.writeHead(404); return res.end('Not Found');
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) page(res, 500, 'Error', `<p class="err">Internal error: ${esc(e.message)}</p>`);
    else res.end();
  }
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`auth-prototype listening on http://127.0.0.1:${cfg.port}`);
  console.log(`  issuer       ${cfg.issuer}`);
  console.log(`  client_id    ${cfg.clientId}`);
  console.log(`  redirect_uri ${cfg.redirectUri}`);
  console.log(`  cookie Secure=${cfg.cookieSecure}`);
  console.log(`  /api/secure  -> ${cfg.pgrstUpstream} (role=${cfg.pgrstRole}, jwt-secret ${cfg.pgrstJwtSecret ? 'set' : 'NOT SET'})`);
});
