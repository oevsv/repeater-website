# Architecture

Frontend for the ÖVSV amateur-radio repeater site (production:
`https://repeater.oevsv.at/`). It is a single-page Angular application with two
pages:

- **`/` – Repeater map** (`FrqmapComponent`): an interactive map of Austria with
  repeater markers, filters, per-repeater coverage overlays, geolocation, and a
  details/info panel.
- **`/list` – Repeater list** (`ListComponent`): a sortable, filterable table of
  all repeaters with a CSV export (a port of the `oevsv-repeaterliste` project).

Both pages share the same chrome (header, breadcrumb, footer) rendered by
`AppComponent`, and talk to the same backend under `/api`.

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Angular `^22` (NgModule-based, **not** standalone components) |
| Change detection | Zone-based (`provideZoneChangeDetection()`), `ChangeDetectionStrategy.Eager` on components |
| Map engine | OpenLayers `^10` (`ol`) |
| Basemap | basemap.at WMTS (`bmaphidpi`, matrix set `google3857`, EPSG:3857) |
| UI / CSS | UIkit, pinned at **`=3.5.8`** (a forked SCSS theme lives under `src/app/scss`) |
| HTTP | `@angular/common/http` (`provideHttpClient(withXhr())`) |
| i18n | `@angular/localize`, XLIFF 1.2, build-time per-locale bundles |
| Bootstrap | `platformBrowserDynamic().bootstrapModule(AppModule)` (`src/main.ts`) |

> **Why zone-based, not zoneless:** Angular 22 bootstraps zoneless by default,
> but this app mutates component state inside RxJS `subscribe` callbacks (HTTP
> responses, geolocation). `provideZoneChangeDetection()` (with `zone.js` loaded
> via `src/polyfills.ts`) is what refreshes the template bindings after those
> callbacks. Removing it silently breaks the filter selects and info panels.

> **Why UIkit is pinned:** the project carries a forked UIkit SCSS theme that uses
> legacy `@import`. UIkit ≥ 3.25 migrated to Sass `@use` modules, which is
> incompatible with the fork. Do not bump UIkit without migrating the theme.

---

## Application structure

```
src/
  main.ts                     bootstrap AppModule
  polyfills.ts                zone.js + @angular/localize/init
  styles.scss                 global styles -> app/scss/app.scss (UIkit fork)
  index.html                  <base href="/">, <app-root>
  proxy.conf.json             dev proxy: /api, /tiles -> repeater.oevsv.at
  locale/messages.de.xlf      German translation bundle (see i18n)
  assets/
    WMTSCapabilities.xml      basemap.at capabilities (parsed at runtime)
    oevsv_banner_white.svg…   logos
  app/
    app.module.ts             root NgModule (declarations + providers)
    app-routing.module.ts     routes: '' -> map, 'list' -> list, 'index.html' -> ''
    app.component.{ts,html}    shell: header, breadcrumb, <router-outlet>, footer
    shorten-url.pipe.ts        truncates long URLs for display
    map/
      frqmap.component.{ts,html,scss}   the map page
      repeater-status.service.ts        planned live-status poll (see monitoring.md)
      sample1.ts                        TypeScript models for API responses
    list/
      list.component.{ts,html,scss}     the list page
```

### Routing (`app-routing.module.ts`)

```ts
{ path: '',           component: FrqmapComponent, pathMatch: 'full' } // home / map
{ path: 'index.html', redirectTo: '', pathMatch: 'full' }            // "/index.html"
{ path: 'list',       component: ListComponent }                     // table
```

`AppComponent` renders the breadcrumb and exposes `isListPage` (from `Router.url`)
so the breadcrumb gains a **Repeater-Map** crumb (links back to `/`) and a
**Links** crumb on the list page.

---

## The map page (`FrqmapComponent`)

Lifecycle: `ngOnInit()` → `loadOptions()` + `initMap()`.

**Map setup (`initMap`)**
- Creates the OL `Map`/`View`, fits the Austria extent (`fitAustria()`), and on
  desktop zooms in 20 % from the full-country fit (`DESKTOP_INITIAL_ZOOM_FACTOR`).
- Loads the **basemap** from `assets/WMTSCapabilities.xml` (parsed with
  `WMTSCapabilities`), builds a `WMTSSource` for layer `bmaphidpi`, and inserts it
  at layer index 0. The basemap is rendered **greyscale** (`desaturate()` sets a
  `grayscale(100%)` canvas filter on pre/postrender) so the coloured coverage
  overlays stand out.
- Adds a `CenterOnUserLocationControl` (a custom OL `Control`) that uses the
  browser Geolocation API and calls back into the component via `onLocate`.

**Repeater markers (`loadSites` → `drawSitesOnMap`)**
- `loadOptions()` (`GET /api/settings`) populates the filter options and a default
  station type, then triggers `loadSites()`.
- `loadSites()` builds the query from the current filters (type / frequency /
  call-sign), fetches the sites, cross-filters them against the cached TRX dump
  (`dumpSiteInfosForFiltering`, `GET /api/trx_type`), and redraws the markers as a
  single OL `VectorLayer` at index 1. A filter change also removes any active
  coverage overlay.
- Each marker is a **transmitter-tower SVG icon** with three independently
  colourable elements (background disc / tower / transmission). Selection turns
  the disc blue; the tower and transmission colours are reserved for live status.
  See [monitoring.md](./monitoring.md).

**Interaction (`map.on('click')`)** — three cases:
1. **Click a repeater** → select it (blue disc), load its details
   (`GET /api/trx_type?site_name=…`) and its coverage tile overlay
   (`changeOverlaySource`), clear any location pin.
2. **Click empty space** → drop a **red** location pin, query the nearest sites
   (`loadInformationForPoint` → `GET /api/rpc/geo?x=&y=`), and show them in the
   info panel.
3. **Geolocate button** → recenter, drop a **blue** pin, and list nearest sites.

**Info panel** (right column in `frqmap.component.html`) animates from 1/5 → 1/3
width when a repeater or a nearby-sites result is shown, with a close (×) button.
On mobile it overlays the map.

---

## The list page (`ListComponent`)

- `ngOnInit()` does `GET /api/trx` and stores the rows.
- `normalize()` pre-computes per-row display values once (the modes string and the
  hover-tooltip items) and **trims URLs** (some feed entries have stray leading
  whitespace, which Angular's URL sanitizer would otherwise render as `unsafe:…`).
- `computeFacets()` derives the filter option lists (types, bands, modes) from the
  data; `ALL_TYPES = 'all'` is the sentinel for "no type filter".
- `applyFilters()` recomputes the visible rows from the search box + type / band /
  mode / status filters and the current sort, and is called on every filter or
  header-click (`handleSort`).
- `typeLabel()` localises station types via `$localize` (`Voice`, `Beacon`, …).
- `exportToCsv()` serialises the currently visible rows to a CSV download with no
  extra dependency (manual quoting/escaping).

---

## API requirements

All calls are relative to **`/api`** (`baseUrl` in the components). In dev they are
proxied to `https://repeater.oevsv.at` (`proxy.conf.json`); in production the app
is served from the same origin as the backend, so the relative paths resolve
directly.

| Endpoint | Used by | Purpose / notes |
|---|---|---|
| `GET /api/settings` | map | Filter options (`FormOptionResponse`); `Accept: application/vnd.pgrst.object+json` (single object). Provides `filter.types[]` with a `default`. |
| `GET /api/site_type` | map | List of sites for the current type filter. Optional `?<type>=eq.true` (PostgREST-style). Returns `Site[]` with `longitude`/`latitude`, mode flags, formatted coords, etc. |
| `GET /api/trx_type` | map | Per-radio (TRX) records. Used both as a full dump for client-side filtering and as `?site_name=eq.<name>[&<type>=eq.true]` for a selected site's details. |
| `GET /api/rpc/geo?x=<lon>&y=<lat>` | map | Nearest sites to a clicked/located point (`PointInformation[]` with `distance`, `site_name`). |
| `GET /api/trx` | list | Full repeater/TRX table for the list page (≈400 rows). Field shape mirrors `list.component.ts`'s `Repeater` interface (callsign, band, frequencies, CTCSS, modes, status, sysop, url, …). |
| `GET /api/repeater_status` | status (planned) | **Not yet implemented.** Intended 3 s status poll → marker tower/transmission colours. Disabled by default. See [monitoring.md](./monitoring.md). |

**Tile overlays (coverage):** per-repeater coverage tiles are XYZ tiles at
`https://repeater.oevsv.at/tiles/<site_name>/{z}/{x}/{y}.png` (spaces → `-`,
slashes → `_`; `maxZoom 16`, EPSG:3857). Proxied under `/tiles` in dev.

**Basemap:** `assets/WMTSCapabilities.xml` (basemap.at), layer `bmaphidpi`, matrix
set `google3857`.

Backend conventions worth noting for whoever maintains the API:
- Responses are JSON arrays (PostgREST-style filtering via `?<col>=eq.<val>`),
  except `/api/settings` which returns a single object via the `vnd.pgrst.object`
  accept header.
- `site_name` is the key that links a `Site`, its TRX records, its coverage tile
  folder, and (for the planned status feed) its live status. It must be spelled
  consistently across all of these.

The API response shapes are typed in `src/app/map/sample1.ts`
(`FormOptionResponse`, `Site`, `TrxInformation`, `PointInformation`, …) and, for
the list page, in `list.component.ts` (`Repeater`).

---

## Internationalisation

- **Source locale:** `en`. **Target locale:** `de` (`src/locale/messages.de.xlf`).
- Translatable text is marked with `i18n` / `i18n-*` attributes in templates and
  `$localize` in TypeScript (e.g. the list page station-type labels).
- **Project convention:** `messages.de.xlf` stores the German text directly in the
  `<source>` element (there are no `<target>` elements); the build uses that as
  the de translation. So the template carries the English source string and the
  XLF carries the German one. Keep this pattern when adding strings.
- Production builds emit **per-locale bundles**: `dist/frq-map/de` and
  `dist/frq-map/en`, each with its own `<base href="/de/">` / `<base href="/en/">`.
  The header has explicit `/en` and `/de` links.
- Missing translations default to a **warning** (English fallback), not an error.

---

## Build, serve, deploy

- **Dev:** `npm start` (`ng serve` with `--no-deprecation`) uses
  `proxy.conf.json` to forward `/api` and `/tiles` to `repeater.oevsv.at`, so
  local development hits the live backend without CORS.
- **Prod:** `ng build --configuration production` → `localize: true` produces the
  two localized bundles under `dist/frq-map/`. The default budget warning and the
  UIkit Sass deprecation warnings are pre-existing and harmless.
- **Hosting / SPA fallback:** client routes like `/de/list` need the host to fall
  back to that locale's `index.html`. An example nginx config (per-locale
  `try_files` fallback, root language redirect, optional `/api` + `/tiles` proxy)
  is documented alongside this project; the key rule is
  `try_files $uri $uri/ /<locale>/index.html` per locale.

---

## Related docs

- [monitoring.md](./monitoring.md) — the prepared (but disabled) 3 s repeater
  status poll and how to finish wiring it to the marker colours.
