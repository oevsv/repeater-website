# Live repeater status monitoring (3 s polling)

This document describes the scaffolding that is already in place to colour the
repeater markers from a live status feed, how it works, and what is still needed
to switch it on.

## Goal

Every **3 seconds** the app should ask the backend for the current status of the
repeaters and recolour two elements of each marker:

- **tower** (the "A" mast) → reflects **online / offline**
- **transmission** (the antenna waves) → reflects **transmitting / idle**

The marker's **background disc** is *not* driven by status — it stays grey and
turns blue only when the user selects (clicks) a repeater. The three elements are
coloured independently, so selection and live status never interfere.

## What is already prepared

### 1. The polling service — `src/app/map/repeater-status.service.ts`

`RepeaterStatusService` owns the polling loop:

```ts
private readonly statusUrl = '/api/repeater_status'; // TODO: real endpoint
private readonly enabled = false;                    // TODO: flip to true
private readonly pollIntervalMs = 3000;

poll(): Observable<RepeaterStatus[]> {
  if (!this.enabled) {
    return EMPTY;                       // disabled -> no requests at all
  }
  return timer(0, this.pollIntervalMs).pipe(
    switchMap(() =>
      this.http.get<RepeaterStatus[]>(this.statusUrl).pipe(
        catchError(() => of<RepeaterStatus[]>([]))   // ignore transient errors
      )
    )
  );
}
```

- `timer(0, 3000)` fires immediately, then every 3 s.
- `switchMap` cancels an in-flight request if the next tick arrives first (no
  pile-up on a slow backend).
- `catchError` swallows a failed request and keeps the loop alive.
- While `enabled === false` the method returns `EMPTY`, so **no HTTP requests are
  made and the markers keep their default colours**. This is the current state.

The expected response shape:

```ts
export interface RepeaterStatus {
  site_name: string;     // identifies the repeater (see "How a repeater is identified")
  online: boolean;       // -> tower colour
  transmitting: boolean; // -> transmission colour
}
```

### 2. The wiring in the map component — `src/app/map/frqmap.component.ts`

`ngOnInit()` starts the subscription (a no-op while the service is disabled):

```ts
this.startStatusPolling();
```

```ts
private startStatusPolling(): void {
  this.statusService.poll().subscribe((statuses) => {
    for (const status of statuses) {
      this.updateRepeaterColors(status.site_name, {
        tower:        status.online       ? TOWER_ONLINE       : TOWER_OFFLINE,
        transmission: status.transmitting ? TRANSMISSION_ACTIVE : TRANSMISSION_IDLE,
      });
    }
  });
}
```

`updateRepeaterColors()` recolours a single marker in place, looking it up by
site name and preserving its selection state:

```ts
updateRepeaterColors(siteName: string, colors: { tower?: string; transmission?: string }): void {
  const feature = this.siteVectorSource?.getFeatureById(siteName);
  if (!feature) { return; }                    // unknown site -> ignored
  if (colors.tower !== undefined)        feature.set('towerColor', colors.tower);
  if (colors.transmission !== undefined) feature.set('txColor', colors.transmission);
  this.styleRepeater(feature);                 // rebuild the icon from current state
}
```

### 3. The colour mapping (placeholders) — `frqmap.component.ts`

```ts
const TOWER_ONLINE        = '#ffffff'; // white
const TOWER_OFFLINE       = '#e53935'; // red
const TRANSMISSION_ACTIVE = '#00c853'; // green
const TRANSMISSION_IDLE   = '#9e9e9e'; // grey
```

Defaults used before the first status arrives: tower `#ffffff`, transmission
`#00c853`.

## How a repeater is identified

Each repeater marker is an OpenLayers `Feature` whose **id is the
`site_name`** (set in `drawSitesOnMap()` via `feature.setId(site.site_name)`).
The status feed is matched to a marker purely by this string:

```
status.site_name  ===  feature id (site_name)
```

`updateRepeaterColors()` resolves it with `VectorSource.getFeatureById(site_name)`.
So the backend **must return the exact same `site_name` strings** the map was
drawn with (same spelling, case and spacing). A status for an unknown / filtered‑out
site is silently ignored.

## Example status endpoint (JSON)

`GET /api/repeater_status` → `200 OK`, `Content-Type: application/json`, an array
with one entry per repeater that should be coloured:

```json
[
  { "site_name": "Bisamberg",   "online": true,  "transmitting": false },
  { "site_name": "Schöckl",     "online": true,  "transmitting": true  },
  { "site_name": "Patscherkofel","online": false, "transmitting": false }
]
```

Notes:

- Only the three fields in `RepeaterStatus` are read; extra fields are harmless.
- Sites omitted from the array keep their current colours (they are not reset).
- The endpoint should be cheap — it is hit every 3 s per open browser tab.

## What is left to do to finish

1. **Build the backend endpoint** that returns the JSON above, keyed by the same
   `site_name` values the markers use.
2. In `repeater-status.service.ts`: set `statusUrl` to the real path and set
   `enabled = true`. (If the endpoint is on `repeater.oevsv.at`, add a route to
   `proxy.conf.json` so local dev avoids CORS, mirroring `/api`.)
3. **Confirm the response shape** matches `RepeaterStatus`; adjust the interface
   and the mapping in `startStatusPolling()` if the backend uses different field
   names or richer states (e.g. a `state` enum instead of two booleans).
4. **Tune the colours** in the `TOWER_*` / `TRANSMISSION_*` constants and decide
   the exact semantics (e.g. should "offline" also grey out the transmission?).
5. **Tear down the subscription** on destroy: capture the `Subscription` from
   `startStatusPolling()` and unsubscribe in `ngOnDestroy()` (implement
   `OnDestroy`). For this single-page app it currently lives for the app's
   lifetime, which is acceptable but not tidy.
6. **Re-apply after redraws (verify):** changing the type/frequency/name filter
   rebuilds the markers with default colours and replaces `siteVectorSource`. The
   next poll tick (≤ 3 s later) re-applies status colours automatically; confirm
   this latency is acceptable, otherwise trigger an immediate refresh after
   `drawSitesOnMap()`.
7. **Operational concerns:** consider auth, rate limiting and caching headers on
   the endpoint given the 3 s cadence.
