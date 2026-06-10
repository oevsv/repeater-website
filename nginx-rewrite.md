# nginx configuration

Example nginx config for serving this site in production. It serves the two
localized SPA bundles, falls back to each locale's `index.html` for client-side
routes (`/list` etc.), and proxies the API and coverage tiles to the backend.

## Background

`ng build --localize` (production) emits **two bundles**, each with its own
`<base href>`:

- `dist/frq-map/de/` — `<base href="/de/">`
- `dist/frq-map/en/` — `<base href="/en/">`

A bare `/` has no bundle of its own, so it must redirect into one of them. Each
locale needs an SPA fallback (`try_files … /<locale>/index.html`) so client
routes like `/de/list` resolve through the Angular router instead of 404ing.

The `/api` and `/tiles` proxies mirror `proxy.conf.json` used in development.

## Server block

```nginx
# /etc/nginx/sites-available/repeater.oevsv.at
server {
    listen 80;
    listen [::]:80;
    server_name repeater.oevsv.at;

    # Redirect all HTTP to HTTPS (let certbot/your TLS terminator manage the cert).
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name repeater.oevsv.at;

    ssl_certificate     /etc/letsencrypt/live/repeater.oevsv.at/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/repeater.oevsv.at/privkey.pem;

    # Angular build output: dist/frq-map/{de,en}/
    root /var/www/repeater/dist/frq-map;

    # ----------------------------------------------------------------------
    # Language selection at the root.
    # The app builds per-locale bundles, each with its own <base href="/de/">
    # or <base href="/en/">. A bare "/" must land in one of them.
    # ----------------------------------------------------------------------
    location = / {
        # Pick a default by browser preference; default to German.
        if ($http_accept_language ~* ^en) {
            return 302 /en/;
        }
        return 302 /de/;
    }

    # Some old links point at /index.html — send them to the language picker.
    location = /index.html {
        return 302 /;
    }

    # ----------------------------------------------------------------------
    # API + coverage tiles: same origin in production, proxied to the backend.
    # (These mirror proxy.conf.json used in development.)
    # ----------------------------------------------------------------------
    location /api/ {
        proxy_pass         https://repeater.oevsv.at;
        proxy_set_header   Host repeater.oevsv.at;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;
    }

    location /tiles/ {
        proxy_pass         https://repeater.oevsv.at;
        proxy_set_header   Host repeater.oevsv.at;
        proxy_ssl_server_name on;
        # Coverage tiles are immutable per build — cache them hard.
        proxy_cache_valid  200 7d;
        expires            7d;
        add_header         Cache-Control "public";
    }

    # ----------------------------------------------------------------------
    # German bundle — SPA fallback to /de/index.html for client routes
    # (/de/list, /de/...). Hashed assets are served directly.
    # ----------------------------------------------------------------------
    location /de/ {
        try_files $uri $uri/ /de/index.html;
    }

    # ----------------------------------------------------------------------
    # English bundle.
    # ----------------------------------------------------------------------
    location /en/ {
        try_files $uri $uri/ /en/index.html;
    }

    # Long-cache the fingerprinted build assets (JS/CSS/fonts/images).
    location ~* \.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp|xml)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Never cache the HTML entry points (so a redeploy is picked up immediately).
    location ~* /(de|en)/index\.html$ {
        add_header Cache-Control "no-cache";
    }
}
```

## Notes

- **Two bundles, two `<base href>`.** Each locale gets its own
  `try_files … /<locale>/index.html` rule — the SPA fallback that makes
  `/de/list` resolve to the Angular router instead of a 404.
- **Root redirect.** `location = /` redirects to a locale (Accept-Language
  sniff, German default). Adjust the default to taste.
- **`/api` and `/tiles` proxy.** These reproduce `proxy.conf.json` from dev. If
  nginx sits on the *same* host that already serves the PostgREST backend and
  tiles, point `proxy_pass` at the local upstream (e.g. `http://127.0.0.1:3000`)
  instead of looping back through the public hostname.
- **Caching.** Fingerprinted assets get `immutable`/1y; the `index.html` files
  are `no-cache` so deploys take effect without a hard refresh; coverage tiles
  get a moderate TTL.

See [architecture.md](./architecture.md) for the build/serve/deploy overview.
```
