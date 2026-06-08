import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import type { FeatureCollection, Point } from 'geojson';
import maplibregl, {
  type GeoJSONSource,
  type LngLatBoundsLike,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';

import { Site } from '../core/models';

/** A click on the map, with the WGS84 location and the site under the cursor (if any). */
export interface MapClick {
  longitude: number;
  latitude: number;
  site: Site | null;
}

/** basemap.at official MapLibre vector style (Web Mercator), CORS-enabled. */
const STYLE_URL = 'https://mapsneu.wien.gv.at/basemapv/bmapv/3857/resources/styles/root.json';
const ATTRIBUTION =
  'Grundkarte &copy; <a href="https://www.basemap.at/" target="_blank" rel="noreferrer">basemap.at</a>, Repeaterdaten CC-BY4.0.';

/** Austria-wide bounds [west, south, east, north] used for the initial view. */
const AUSTRIA_BOUNDS: LngLatBoundsLike = [
  [9.4, 46.3],
  [17.2, 49.1],
];

const SITES_SOURCE = 'sites';
const SITES_LAYER = 'site-markers';
const SELECTED_LAYER = 'site-markers-selected';
const OVERLAY_SOURCE = 'site-overlay';
const OVERLAY_LAYER = 'site-overlay';
const ICON_DEFAULT = 'dot-red';
const ICON_SELECTED = 'dot-green';
/** A filter value that matches no site, used to hide the "selected" layer. */
const NO_SITE = ' ';

// Basemap recolouring ("mixed" = muted colours): mostly desaturate + soften so the
// markers stand out, but keep a hint of the original colour.
const DESATURATE = 0.7;
const CONTRAST = 0.85;
const LIGHTEN = 0.12;

/** basemap.at advertises maxzoom 19 in its TileJSON but only serves vector tiles to z16. */
const BASEMAP_MAX_ZOOM = 16;

/**
 * Owns the MapLibre GL map instance and all source/layer manipulation.
 *
 * Provided per map component instance so map state is never shared. The public
 * surface ({@link init}, {@link drawSites}, {@link showOverlay}, {@link hideOverlay},
 * {@link click$}, {@link destroy}) is map-library agnostic.
 */
@Injectable()
export class MapService {
  private map?: maplibregl.Map;
  private ready = false;
  private pendingSites: Site[] | null = null;
  private sitesByName = new Map<string, Site>();
  private userLocationMarker?: maplibregl.Marker;

  private readonly clickSubject = new Subject<MapClick>();
  readonly click$: Observable<MapClick> = this.clickSubject.asObservable();

  /** Creates the map on the given target element and loads the basemap style. */
  init(target: string | HTMLElement): void {
    void this.createMap(target);
  }

  /**
   * Fetches the basemap.at vector style and rewrites its relative `sprite`,
   * `glyphs` and source URLs to absolute ones — MapLibre rejects relative URLs
   * in a style (e.g. `Invalid sprite URL "../sprites/sprite"`) — then creates
   * the map.
   */
  private async createMap(target: string | HTMLElement): Promise<void> {
    let style: unknown = STYLE_URL;
    try {
      const json = (await (await fetch(STYLE_URL)).json()) as Record<string, unknown>;
      await this.resolveStyle(json as Record<string, any>);
      style = json;
    } catch (error) {
      console.error('Could not load basemap style', error);
    }

    const map = new maplibregl.Map({
      container: target,
      style: style as StyleSpecification,
      center: [13.3, 47.7],
      zoom: 6.3,
      attributionControl: false,
    });
    this.map = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    // We render our own persistent location marker on the `geolocate` event
    // (the built-in dot can be hidden by the surrounding theme's global CSS).
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: false,
      showUserLocation: false,
    });
    map.addControl(geolocate, 'top-left');
    geolocate.on('geolocate', (event: any) =>
      this.showUserLocation(event.coords.longitude, event.coords.latitude),
    );

    map.addControl(new maplibregl.AttributionControl({ customAttribution: ATTRIBUTION }));

    map.fitBounds(AUSTRIA_BOUNDS, { padding: 20, animate: false });
    map.on('load', () => void this.onStyleLoaded());
    map.on('click', (event) => this.onClick(event));
  }

  /**
   * Resolves the style's relative `sprite`/`glyphs` URLs to absolute, and inlines
   * each vector source's tiles as absolute URLs (fetching its TileJSON), because
   * MapLibre does not resolve relative URLs when a style is supplied as an object.
   */
  private async resolveStyle(style: Record<string, any>): Promise<void> {
    if (typeof style['sprite'] === 'string') {
      style['sprite'] = this.absolute(style['sprite'], STYLE_URL);
    }
    if (typeof style['glyphs'] === 'string') {
      style['glyphs'] = this.absolute(style['glyphs'], STYLE_URL);
    }
    const sources = Object.values<any>(style['sources'] ?? {});
    await Promise.all(sources.map((source) => this.resolveSource(source)));
    this.recolorStyle(style);
  }

  /** Recolours every layer's paint to the muted "mixed" palette so markers stand out. */
  private recolorStyle(style: Record<string, any>): void {
    for (const layer of (style['layers'] ?? []) as Record<string, any>[]) {
      if (layer['paint']) {
        this.recolorContainer(layer['paint']);
      }
      this.hideRoadNumberShield(layer);
    }
  }

  /**
   * Road-number shields (motorway A-roads, B-roads, exits) are multicolour sprite
   * icons with no `icon-color`, so they can't be recoloured. Hide the coloured
   * shield but keep the (already recoloured) number text so they blend in.
   */
  private hideRoadNumberShield(layer: Record<string, any>): void {
    const icon = layer['layout']?.['icon-image'];
    const iconStr = typeof icon === 'string' ? icon : JSON.stringify(icon ?? '');
    if (layer['type'] === 'symbol' && /_Nr/i.test(iconStr)) {
      layer['paint'] = layer['paint'] ?? {};
      layer['paint']['icon-opacity'] = 0;
    }
  }

  /** Recursively recolours any colour (string or rgb/rgba expression) within a paint value. */
  private recolorContainer(container: any): void {
    const entries: [string | number, any][] = Array.isArray(container)
      ? container.map((v, i) => [i, v])
      : Object.keys(container).map((k) => [k, container[k]]);
    for (const [key, value] of entries) {
      const recoloured = this.asColor(value);
      if (recoloured !== null) {
        container[key] = recoloured;
      } else if (value && typeof value === 'object') {
        this.recolorContainer(value);
      }
    }
  }

  /** Recolours a colour string or `["rgb"|"rgba", ...]` expression; null if not a colour. */
  private asColor(value: any): string | null {
    if (typeof value === 'string') {
      return this.transformColor(value);
    }
    if (
      Array.isArray(value) &&
      (value[0] === 'rgb' || value[0] === 'rgba') &&
      value.slice(1).every((n: unknown) => typeof n === 'number')
    ) {
      return this.transformRgba(value[1], value[2], value[3], value[4] ?? 1);
    }
    return null;
  }

  /** Parses a hex/rgb(a)/hsl(a) colour and recolours it; null if not a colour. */
  private transformColor(input: string): string | null {
    const value = input.trim();
    let r: number;
    let g: number;
    let b: number;
    let a = 1;
    let match: RegExpExecArray | null;

    if ((match = /^#([0-9a-f]{3,8})$/i.exec(value))) {
      let hex = match[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split('').map((c) => c + c).join('');
      }
      if (hex.length !== 6 && hex.length !== 8) {
        return null;
      }
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) {
        a = parseInt(hex.slice(6, 8), 16) / 255;
      }
    } else if ((match = /^rgba?\(([^)]+)\)$/i.exec(value))) {
      const parts = match[1].split(',').map((p) => parseFloat(p));
      [r, g, b] = parts;
      if (parts[3] !== undefined) a = parts[3];
    } else if ((match = /^hsla?\(([^)]+)\)$/i.exec(value))) {
      const parts = match[1].split(',').map((p) => parseFloat(p));
      [r, g, b] = this.hslToRgb(parts[0] / 360, parts[1] / 100, parts[2] / 100);
      if (parts[3] !== undefined) a = parts[3];
    } else {
      return null;
    }
    return this.transformRgba(r, g, b, a);
  }

  /** Desaturates toward luminance, then applies CONTRAST and LIGHTEN. */
  private transformRgba(r: number, g: number, b: number, a: number): string | null {
    if ([r, g, b].some((c) => Number.isNaN(c))) {
      return null;
    }
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const channel = (c: number): number => {
      let x = c + (lum - c) * DESATURATE;
      x = 128 + (x - 128) * CONTRAST;
      x = x + (255 - x) * LIGHTEN;
      return Math.round(Math.min(255, Math.max(0, x)));
    };
    const R = channel(r);
    const G = channel(g);
    const B = channel(b);
    return a >= 1 ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${a})`;
  }

  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = (t: number): number => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [
      Math.round(hue(h + 1 / 3) * 255),
      Math.round(hue(h) * 255),
      Math.round(hue(h - 1 / 3) * 255),
    ];
  }

  private async resolveSource(source: Record<string, any>): Promise<void> {
    if (Array.isArray(source['tiles'])) {
      source['tiles'] = source['tiles'].map((tile: string) => this.absolute(tile, STYLE_URL));
      return;
    }
    if (typeof source['url'] !== 'string') {
      return;
    }
    const tileJsonUrl = this.absolute(source['url'], STYLE_URL);
    try {
      const tileJson = (await (await fetch(tileJsonUrl)).json()) as Record<string, any>;
      if (Array.isArray(tileJson['tiles'])) {
        source['tiles'] = tileJson['tiles'].map((tile: string) => this.absolute(tile, tileJsonUrl));
      }
      for (const key of ['minzoom', 'maxzoom', 'bounds', 'scheme', 'attribution']) {
        if (tileJson[key] !== undefined && source[key] === undefined) {
          source[key] = tileJson[key];
        }
      }
      if (source['type'] === 'vector') {
        source['maxzoom'] = Math.min((source['maxzoom'] as number) ?? BASEMAP_MAX_ZOOM, BASEMAP_MAX_ZOOM);
      }
      delete source['url'];
    } catch {
      source['url'] = tileJsonUrl;
    }
  }

  /** Resolves a possibly-relative URL against a base, preserving `{...}` tokens. */
  private absolute(value: string, base: string): string {
    if (/^https?:\/\//.test(value)) {
      return value;
    }
    const braceIndex = value.indexOf('{');
    if (braceIndex === -1) {
      return new URL(value, base).href;
    }
    return new URL(value.slice(0, braceIndex), base).href + value.slice(braceIndex);
  }

  /** Replaces the marker layer with one marker per site. */
  drawSites(sites: Site[]): void {
    this.sitesByName = new Map(sites.map((site) => [site.site_name, site]));

    if (!this.map || !this.ready) {
      this.pendingSites = sites;
      return;
    }

    (this.map.getSource(SITES_SOURCE) as GeoJSONSource).setData(this.toFeatureCollection(sites));
    this.setSelected(null);
  }

  /** Shows the per-site tile overlay, replacing any previous overlay. */
  showOverlay(tilesBaseUrl: string): void {
    if (!this.map || !this.ready) {
      return;
    }
    this.hideOverlay();
    this.map.addSource(OVERLAY_SOURCE, {
      type: 'raster',
      tiles: [`${tilesBaseUrl}/{z}/{x}/{y}.png`],
      tileSize: 256,
      maxzoom: 16,
    });
    // Insert below the markers so they stay visible on top of the overlay.
    this.map.addLayer({ id: OVERLAY_LAYER, type: 'raster', source: OVERLAY_SOURCE }, SITES_LAYER);
  }

  /** Removes the per-site tile overlay, if present. */
  hideOverlay(): void {
    if (!this.map) {
      return;
    }
    if (this.map.getLayer(OVERLAY_LAYER)) {
      this.map.removeLayer(OVERLAY_LAYER);
    }
    if (this.map.getSource(OVERLAY_SOURCE)) {
      this.map.removeSource(OVERLAY_SOURCE);
    }
  }

  /** Shows (or moves) a persistent marker at the user's current location. */
  private showUserLocation(longitude: number, latitude: number): void {
    if (!this.map) {
      return;
    }
    if (this.userLocationMarker) {
      this.userLocationMarker.setLngLat([longitude, latitude]);
      return;
    }
    const element = document.createElement('div');
    element.className = 'user-location-dot';
    this.userLocationMarker = new maplibregl.Marker({ element })
      .setLngLat([longitude, latitude])
      .addTo(this.map);
  }

  /** Tears down the map; call from the host component's destroy hook. */
  destroy(): void {
    this.userLocationMarker?.remove();
    this.userLocationMarker = undefined;
    this.map?.remove();
    this.map = undefined;
    this.ready = false;
  }

  private async onStyleLoaded(): Promise<void> {
    const map = this.map;
    if (!map) {
      return;
    }

    await Promise.all([
      this.addIcon(ICON_DEFAULT, 'assets/dot_red.png'),
      this.addIcon(ICON_SELECTED, 'assets/dot_green.png'),
    ]);

    map.addSource(SITES_SOURCE, { type: 'geojson', data: this.toFeatureCollection([]) });
    map.addLayer({
      id: SITES_LAYER,
      type: 'symbol',
      source: SITES_SOURCE,
      layout: { 'icon-image': ICON_DEFAULT, 'icon-size': 0.7, 'icon-allow-overlap': true },
    });
    map.addLayer({
      id: SELECTED_LAYER,
      type: 'symbol',
      source: SITES_SOURCE,
      filter: ['==', ['get', 'site_name'], NO_SITE],
      layout: { 'icon-image': ICON_SELECTED, 'icon-size': 0.7, 'icon-allow-overlap': true },
    });

    map.on('mouseenter', SITES_LAYER, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', SITES_LAYER, () => (map.getCanvas().style.cursor = ''));

    this.ready = true;
    if (this.pendingSites) {
      this.drawSites(this.pendingSites);
      this.pendingSites = null;
    }
  }

  private onClick(event: MapMouseEvent): void {
    if (!this.map || !this.ready) {
      return;
    }
    const [feature] = this.map.queryRenderedFeatures(event.point, { layers: [SITES_LAYER] });
    const siteName = feature?.properties?.['site_name'] as string | undefined;
    const site = siteName ? (this.sitesByName.get(siteName) ?? null) : null;

    this.setSelected(site ? site.site_name : null);
    this.clickSubject.next({
      longitude: event.lngLat.lng,
      latitude: event.lngLat.lat,
      site,
    });
  }

  private setSelected(siteName: string | null): void {
    if (this.map?.getLayer(SELECTED_LAYER)) {
      this.map.setFilter(SELECTED_LAYER, ['==', ['get', 'site_name'], siteName ?? NO_SITE]);
    }
  }

  private async addIcon(name: string, url: string): Promise<void> {
    const map = this.map;
    if (!map || map.hasImage(name)) {
      return;
    }
    const { data } = await map.loadImage(url);
    if (!map.hasImage(name)) {
      map.addImage(name, data);
    }
  }

  private toFeatureCollection(sites: Site[]): FeatureCollection<Point> {
    return {
      type: 'FeatureCollection',
      features: sites.map((site) => ({
        type: 'Feature',
        properties: { site_name: site.site_name },
        geometry: { type: 'Point', coordinates: [site.longitude, site.latitude] },
      })),
    };
  }
}
