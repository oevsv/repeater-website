import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';

import { Feature, Map, View } from 'ol';
import { Control, defaults as defaultControls } from 'ol/control';
import { Extent } from 'ol/extent';
import WMTSCapabilities from 'ol/format/WMTSCapabilities';
import { Point } from 'ol/geom';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat, toLonLat } from 'ol/proj';
import { XYZ } from 'ol/source';
import VectorSource from 'ol/source/Vector';
import WMTS, { optionsFromCapabilities } from 'ol/source/WMTS';
import { Icon, Style } from 'ol/style';

import { Site } from '../core/models';

/** A click on the map, with the WGS84 location and the site under the cursor (if any). */
export interface MapClick {
  longitude: number;
  latitude: number;
  site: Site | null;
}

const BASEMAP_CAPABILITIES_URL = 'assets/WMTSCapabilities.xml';
const ATTRIBUTION =
  'Grundkarte &copy; <a href="//www.basemap.at/">basemap.at</a>, Repeaterdaten CC-BY4.0.';

/** Austria-wide extent (EPSG:3857) used as the initial view. */
const AUSTRIA_EXTENT: Extent = [908071, 5751733, 2047289, 6375459];

function markerStyle(src: string): Style {
  return new Style({ image: new Icon({ anchor: [0.5, 0.5], src, scale: 0.7 }) });
}

const ICON_DEFAULT = markerStyle('assets/dot_red.png');
const ICON_SELECTED = markerStyle('assets/dot_green.png');

/**
 * Owns the OpenLayers map instance and all layer manipulation.
 *
 * Provided per map component instance so map state is never shared.
 */
@Injectable()
export class MapService {
  private readonly http = inject(HttpClient);
  private readonly capabilitiesParser = new WMTSCapabilities();

  private map?: Map;
  private markerLayer?: VectorLayer<VectorSource<Feature<Point>>>;
  private overlayLayer?: TileLayer<XYZ>;
  private selectedFeature?: Feature<Point>;

  private readonly clickSubject = new Subject<MapClick>();
  readonly click$: Observable<MapClick> = this.clickSubject.asObservable();

  /** Creates the map on the given target element and loads the basemap. */
  init(target: string | HTMLElement): void {
    this.map = new Map({
      target,
      controls: defaultControls().extend([new CenterOnUserLocationControl()]),
      view: new View({ center: [0, 0], zoom: 10 }),
      layers: [],
      pixelRatio: 1,
    });

    this.map.getView().fit(AUSTRIA_EXTENT, { size: this.map.getSize() });
    this.loadBasemap();
    this.registerInteractions();

    // The container may still be resizing right after creation; nudge the map a few times.
    for (const delay of [100, 300, 1000]) {
      setTimeout(() => this.map?.updateSize(), delay);
    }
  }

  /** Replaces the marker layer with one marker per site. */
  drawSites(sites: Site[]): void {
    if (!this.map) {
      return;
    }

    if (this.markerLayer) {
      this.map.removeLayer(this.markerLayer);
    }
    this.selectedFeature = undefined;

    const features = sites.map((site) => {
      const feature = new Feature({
        geometry: new Point(fromLonLat([site.longitude, site.latitude])),
        site,
      });
      feature.setId(site.site_name);
      feature.setStyle(ICON_DEFAULT);
      return feature;
    });

    this.markerLayer = new VectorLayer({ source: new VectorSource({ features }) });
    this.map.addLayer(this.markerLayer);
  }

  /** Shows the per-site tile overlay, replacing any previous overlay. */
  showOverlay(tilesBaseUrl: string): void {
    if (!this.map) {
      return;
    }
    this.hideOverlay();
    this.overlayLayer = new TileLayer({
      source: new XYZ({ url: `${tilesBaseUrl}/{z}/{x}/{y}.png`, maxZoom: 16 }),
      opacity: 1,
    });
    this.map.addLayer(this.overlayLayer);
  }

  /** Removes the per-site tile overlay, if present. */
  hideOverlay(): void {
    if (this.map && this.overlayLayer) {
      this.map.removeLayer(this.overlayLayer);
      this.overlayLayer = undefined;
    }
  }

  /** Tears down the map; call from the host component's destroy hook. */
  destroy(): void {
    this.map?.setTarget(undefined);
    this.map = undefined;
  }

  private loadBasemap(): void {
    this.http
      .get(BASEMAP_CAPABILITIES_URL, { observe: 'body', responseType: 'text' })
      .subscribe((xml) => {
        const capabilities = this.capabilitiesParser.read(xml);
        const options = optionsFromCapabilities(capabilities, {
          layer: 'bmaphidpi',
          matrixSet: 'google3857',
        });
        if (!options || !this.map) {
          return;
        }
        options.attributions = ATTRIBUTION;
        this.map.getLayers().insertAt(0, new TileLayer({ source: new WMTS(options) }));
      });
  }

  private registerInteractions(): void {
    if (!this.map) {
      return;
    }
    const map = this.map;

    map.on('pointermove', (event) => {
      const hit = map.hasFeatureAtPixel(map.getEventPixel(event.originalEvent));
      map.getTargetElement().style.cursor = hit ? 'pointer' : '';
    });

    map.on('click', (event) => {
      const [longitude, latitude] = toLonLat(event.coordinate);
      const feature =
        map.forEachFeatureAtPixel(event.pixel, (f) => f as Feature<Point>) ?? null;
      this.highlight(feature);
      const site = (feature?.get('site') as Site | undefined) ?? null;
      this.clickSubject.next({ longitude, latitude, site });
    });
  }

  private highlight(feature: Feature<Point> | null): void {
    this.selectedFeature?.setStyle(ICON_DEFAULT);
    feature?.setStyle(ICON_SELECTED);
    this.selectedFeature = feature ?? undefined;
  }
}

/** Custom OpenLayers control that recenters the map on the user's GPS location. */
class CenterOnUserLocationControl extends Control {
  constructor() {
    const button = document.createElement('button');
    button.innerHTML = '&#8226;';
    button.type = 'button';

    const element = document.createElement('div');
    element.className = 'center-user-location ol-unselectable ol-control';
    element.appendChild(button);

    super({ element });

    button.addEventListener('click', () => this.centerOnUser());
    button.addEventListener('touchstart', () => this.centerOnUser());
  }

  private centerOnUser(): void {
    if (!navigator.geolocation) {
      console.warn('Geolocation is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const center = fromLonLat([position.coords.longitude, position.coords.latitude]);
        const view = this.getMap()?.getView();
        view?.setCenter(center);
        view?.setZoom(14);
      },
      (error) => console.warn('Could not determine user location', error),
    );
  }
}
