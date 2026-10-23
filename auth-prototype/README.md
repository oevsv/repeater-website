# Auth prototype — OpenID Connect login for repeater.oevsv.at

A tiny, **zero-dependency** Node server (Node ≥ 20) that implements the
server-side half of an OpenID Connect **Authorization Code + PKCE** login against
the OEVSV Keycloak realm, for the confidential client `oevsv.repeater`.

It exposes three paths that nginx proxies to it:

| Path | What it does |
|---|---|
| `GET /login` | Starts the flow: sets a short-lived signed cookie (state/nonce/PKCE verifier) and 302-redirects the browser to Keycloak. |
| `GET /authorized` | OAuth callback. Exchanges the `code` for tokens **server-side** (secret stays here), verifies the `id_token` signature against the realm JWKS, then shows the user's claims (callsign, name, e-mail, …). |
| `GET /logout` | Clears the session cookie and does an RP-initiated logout at Keycloak. |

## Why a backend at all?

`oevsv.repeater` is a **confidential** client — the token exchange requires the
`client_secret`. A browser-only (Angular) implementation would have to ship that
secret to every visitor. So the exchange must happen on a server. This process is
that server; the Angular SPA is untouched.

## Security / privacy

- **No secret is in the repo.** The secret is read from the environment only.
  `.env` is gitignored; `.env.example` is a template with placeholders.
- The secret and the `code_verifier` never reach the browser.
- The `id_token` signature is verified (RS256/PS\*) against the realm JWKS, plus
  `iss` / `aud` / `exp` / `nonce` checks.
- Session is a signed, `HttpOnly`, `SameSite=Lax`, `Secure` cookie (this is a
  prototype — for production prefer a server-side session store).

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

Add these three location blocks (they must come **before** the `/de/` `/en/`
and regex blocks so they win). See `../nginx-rewrite.md` for the full server block.

```nginx
    # --- OIDC login prototype (proxied to the Node auth service) ---
    location = /login      { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
    location = /authorized { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
    location = /logout     { proxy_pass http://127.0.0.1:8780; include /etc/nginx/snippets/auth-proxy.conf; }
```

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
`/authorized`, which prints the identity.

### Keycloak checklist (ask the IT contact if logout misbehaves)

- Allowed redirect URIs already cover `https://repeater.oevsv.at/*` ✓ (so
  `/authorized` is fine).
- For clean logout, the client's **Valid post logout redirect URIs** should include
  `https://repeater.oevsv.at/` (or `+` to reuse the redirect URIs). If it doesn't,
  Keycloak still logs the user out but shows its own page instead of redirecting back.

## Files

- `server.js` — the service (zero dependencies).
- `.env.example` — config template (copy to `.env`, never commit `.env`).
