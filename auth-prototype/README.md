# Auth prototype — OpenID Connect login for repeater.oevsv.at

A tiny, **zero-dependency** Node server (Node ≥ 20) that implements the
server-side half of an OpenID Connect **Authorization Code + PKCE** login against
the OEVSV Keycloak realm, for the confidential client `oevsv.repeater`.

It also acts as a **BFF (backend-for-frontend)**: it keeps all tokens on the
server and exposes an authenticated passthrough to PostgREST, so the browser
never holds a token — only an `HttpOnly` session cookie.

It exposes these paths, which nginx proxies to it:

| Path | What it does |
|---|---|
| `GET /login` | Starts the flow: sets a short-lived signed cookie (state/nonce/PKCE verifier) and 302-redirects the browser to Keycloak. |
| `GET /authorized` | OAuth callback. Exchanges the `code` for tokens **server-side** (secret stays here), verifies the `id_token` signature against the realm JWKS, then shows the user's claims (callsign, name, e-mail, …) and sets the session cookie. |
| `GET /me` | Returns the logged-in user's **display-safe** claims as JSON (`callsign`, `name`, `email`, `email_verified`, `sub`), or `401 {"authenticated":false}`. Backs the Angular login widget. Never returns a token. |
| `ANY /api/secure/*` | Authenticated proxy to PostgREST. Requires a session (else `401`), mints a short-lived signed JWT carrying the identity, and forwards the request to PostgREST on localhost. See [Connecting to PostgREST](#connecting-to-postgrest-apisecure). |
| `GET /logout` | Clears the session cookie and does an RP-initiated logout at Keycloak. |
| `GET /healthz` | Liveness probe → `ok`. |

### Request flow (BFF)

```
Browser ──/api/secure/… + oidc_session cookie──▶ Node ──/… + Bearer <minted JWT>──▶ PostgREST ──▶ Postgres
         (HttpOnly cookie, no token)             (verifies session,              (verifies JWT sig,
                                                  mints identity JWT)             SET ROLE, reads claims, RLS)
```

## Why a backend at all?

`oevsv.repeater` is a **confidential** client — the token exchange requires the
`client_secret`. A browser-only (Angular) implementation would have to ship that
secret to every visitor. So the exchange must happen on a server. This process is
that server; the Angular SPA is untouched.

## Security / privacy

- **No secret is in the repo.** The Keycloak client secret and the PostgREST
  shared secret are read from the environment only. `.env` is gitignored;
  `.env.example` is a template with placeholders.
- **No token ever reaches the browser.** The client secret, the Keycloak
  tokens, the `code_verifier`, and the minted PostgREST JWT all stay on the
  server. The browser holds only the `HttpOnly` session cookie; `/me` returns
  display claims, not tokens.
- The `id_token` signature is verified (RS256/PS\*) against the realm JWKS, plus
  `iss` / `aud` / `exp` / `nonce` checks.
- Session is a signed, `HttpOnly`, `SameSite=Lax`, `Secure` cookie (this is a
  prototype — for production prefer a server-side session store).
- The JWT minted for PostgREST is **short-lived** (`PGRST_TOKEN_TTL`, default
  30 s) and freshly signed per request, so a leaked token is useless almost
  immediately.
- PostgREST must listen on **localhost only** (`server-host = 127.0.0.1`) so the
  only way to reach `/api/secure` data is through this authenticated proxy.

## Run locally (smoke test)

The full browser flow needs the real redirect URI `https://repeater.oevsv.at/authorized`
(it must match the client's allowed redirect URIs — `localhost` won't), so local
testing mostly exercises `/login` building the redirect. Still useful:

```bash
cd auth-prototype
cp .env.example .env         # then edit .env, set OIDC_CLIENT_SECRET + COOKIE_SECRET
export COOKIE_SECURE=false   # cookies over http for local testing
set -a; . ./.env; set +a
node server.js
# in another shell:
curl -si http://127.0.0.1:8780/login | grep -i '^location'   # should point at id.oevsv.at/.../auth
```

## Production deployment

Two pieces: **(1)** run this process with the secret in its environment, and
**(2)** point nginx's `/login`, `/authorized`, `/logout` at it.

### 1. The service + where the secret lives

Keep the secret in a root-only env file that is **not** in the repo, e.g.
`/etc/repeater-auth.env`:

```ini
# /etc/repeater-auth.env   (chmod 600, owned by root — NOT in git)
OIDC_CLIENT_SECRET=abcde...the secret...
COOKIE_SECRET=<output of: openssl rand -hex 32>
OIDC_REDIRECT_URI=https://repeater.oevsv.at/authorized
OIDC_POST_LOGOUT_URI=https://repeater.oevsv.at/

# For the /api/secure -> PostgREST proxy (see the PostgREST section below):
PGRST_JWT_SECRET=<openssl rand -hex 32 — MUST equal PostgREST's jwt-secret>
# PGRST_UPSTREAM=http://127.0.0.1:3000
# PGRST_ROLE=web_user
# PGRST_STRIP_PREFIX=/api/secure   # if PostgREST serves tables at its root
```

```bash
sudo install -m 600 /dev/null /etc/repeater-auth.env
sudo editor /etc/repeater-auth.env        # paste the values above
```

Run it under systemd so the secret is loaded from that file (never on a command
line, never in the repo):

```ini
# /etc/systemd/system/repeater-auth.service
[Unit]
Description=repeater.oevsv.at OIDC auth prototype
After=network.target

[Service]
# Point this at wherever the repo is deployed on the server:
WorkingDirectory=/var/www/repeater/auth-prototype
ExecStart=/usr/bin/node server.js
EnvironmentFile=/etc/repeater-auth.env
Environment=PORT=8780
DynamicUser=yes
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now repeater-auth.service
sudo systemctl status repeater-auth.service
curl -s http://127.0.0.1:8780/healthz    # -> ok
```

### 2. nginx — add to the existing `server { … }` for repeater.oevsv.at

Add these location blocks (the exact-match ones always win over the `/de/`
`/en/` and regex blocks regardless of order; `^~ /api/secure/` wins over a
generic `/api/`). See `../nginx-rewrite.md` for the full server block.

```nginx
    # --- OIDC login prototype (proxied to the Node auth service) ---
    location = /login      { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
    location = /authorized { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
    location = /logout     { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
    location = /me         { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }

    # Authenticated API passthrough to PostgREST (via the Node BFF).
    # ^~ so this prefix beats any generic "location /api/".
    location ^~ /api/secure/ { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
```

> Keep PostgREST itself off the public server (bind it to `127.0.0.1:3000`).
> Any existing `location /api/ { proxy_pass … PostgREST }` block now only serves
> public/anon endpoints; everything requiring a user goes through `/api/secure/`.

```nginx
# /etc/nginx/snippets/auth-proxy.conf
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;   # so the app knows it is behind https
proxy_http_version 1.1;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Then browse to `https://repeater.oevsv.at/login` → Keycloak login → back to
`/authorized`, which prints the identity. The Angular login widget (top-right)
calls `/me`; authenticated data calls go to `/api/secure/…`.

### Keycloak checklist (ask the IT contact if logout misbehaves)

- Allowed redirect URIs already cover `https://repeater.oevsv.at/*` ✓ (so
  `/authorized` is fine).
- For clean logout, the client's **Valid post logout redirect URIs** should include
  `https://repeater.oevsv.at/` (or `+` to reuse the redirect URIs). If it doesn't,
  Keycloak still logs the user out but shows its own page instead of redirecting back.

## Connecting to PostgREST (`/api/secure`)

`/api/secure/*` is an **authenticated passthrough** to PostgREST. For every
request it:

1. Requires a valid `oidc_session` cookie — otherwise `401 {"error":"authentication required"}` (nothing is forwarded).
2. Mints a fresh, short-lived **HS256 JWT** carrying the Postgres `role` plus the
   identity claims (`callsign`, `name`, `email`, `sub`), signed with
   `PGRST_JWT_SECRET`.
3. Forwards the request (any method, body, query) to `PGRST_UPSTREAM`
   (default `http://127.0.0.1:3000`) with `Authorization: Bearer <minted JWT>`,
   and relays the response.

PostgREST then verifies the signature with the **same** secret, switches to the
role in the `role` claim, and exposes the other claims to SQL.

### Path mapping

By default the full path is preserved: `/api/secure/whoami` → PostgREST
`/api/secure/whoami`. PostgREST serves tables/views at its **root**, so if you
want `/api/secure/whoami` → PostgREST `/whoami`, set:

```ini
PGRST_STRIP_PREFIX=/api/secure
```

### PostgREST config (`postgrest.conf`)

```ini
db-uri       = "postgres://authenticator@localhost/yourdb"
db-schemas   = "api"
db-anon-role = "web_anon"
server-host  = "127.0.0.1"     # localhost only — reachable only via the Node BFF
server-port  = 3000
jwt-secret   = "<the SAME value as PGRST_JWT_SECRET>"
# jwt-role-claim-key defaults to ".role" → matches the minted token
```

### Database roles + reading the identity in SQL

```sql
create role web_anon nologin;
create role web_user nologin;               -- = PGRST_ROLE
grant web_anon, web_user to authenticator;

-- the injected identity is in the JWT claims, available as JSON:
--   current_setting('request.jwt.claims', true)::json ->> 'callsign'
create or replace view api.whoami as
  select current_setting('request.jwt.claims', true)::json ->> 'callsign' as callsign,
         current_setting('request.jwt.claims', true)::json ->> 'name'     as name,
         current_setting('request.jwt.claims', true)::json ->> 'email'    as email,
         current_setting('request.jwt.claims', true)::json ->> 'sub'      as sub;
grant select on api.whoami to web_user;
```

Now `GET /api/secure/whoami` (with `PGRST_STRIP_PREFIX=/api/secure`) returns the
logged-in user's own identity, straight from PostgREST. Row-level-security
policies can key off the same claims, e.g. restrict rows to
`owner_sub = current_setting('request.jwt.claims', true)::json ->> 'sub'`.

### Quick local test (mock upstream)

With the service running and a mock on `:3000` that echoes the `Authorization`
header, you can confirm the identity is injected and the signature is valid
without a real database. Unauthenticated calls return `401`; authenticated calls
show `role`, `callsign`, `name`, `email`, `sub` in the forwarded token.

## The Angular side (login widget)

The SPA is otherwise untouched; the only addition is a top-right login widget
(`../src/app/auth/login-widget.component.*`, declared in `app.module.ts`):

- Logged out → key icon + **Login**, links to `/login`.
- Logged in → user icon + **callsign**; clicking shows name / e-mail / `sub` and
  a **Log out** link to `/logout`.

It only `fetch`es `/me` (cookie sent automatically) — no token handling in the
browser. The `@@auth*` i18n labels need German strings in `messages.de.xlf` for
a `--localize` build (they fall back to the English source otherwise).

### Local dev with `ng serve`

The Angular dev server must proxy the auth routes to this service. Add to
`../proxy.conf.json`:

```json
{
  "/login":      { "target": "http://localhost:8780", "secure": false },
  "/authorized": { "target": "http://localhost:8780", "secure": false },
  "/logout":     { "target": "http://localhost:8780", "secure": false },
  "/me":         { "target": "http://localhost:8780", "secure": false },
  "/api/secure": { "target": "http://localhost:8780", "secure": false }
}
```

(The full browser login still needs the real `https://repeater.oevsv.at/authorized`
redirect URI, since `localhost` is not in the client's allowed redirect URIs.)

## Files

- `server.js` — the service (zero dependencies): login, callback, `/me`,
  `/logout`, and the `/api/secure` PostgREST proxy.
- `.env.example` — config template (copy to `.env`, never commit `.env`).
- `../src/app/auth/login-widget.component.*` — the Angular login widget.
