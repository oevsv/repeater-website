import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, ViewChild } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import sampleResponseToReq1, {
  Filter,
  FormOptionResponse,
  LayerConfiguration,
  RepeaterType,
  PointInformation,
  PointLocation,
  TrxInformation,
} from './sample1';

import Map from "ol/Map";
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import TileGrid from "ol/tilegrid/TileGrid";
import WMTSGrid from "ol/tilegrid/WMTS";
import OSM from 'ol/source/OSM';
import WMTSSource, {optionsFromCapabilities} from 'ol/source/WMTS'
import * as olProj from "ol/proj";
import {Extent, boundingExtent} from "ol/extent";
import {HttpClient} from "@angular/common/http";
import {ActivatedRoute, Router} from "@angular/router";
import {Title} from "@angular/platform-browser";
import {Source, XYZ} from "ol/source";
import {Coordinate} from "ol/coordinate";
import VectorSource from "ol/source/Vector";
import {Collection, Feature, Overlay} from "ol";
import {GeoJSON} from "ol/format";
import VectorLayer from "ol/layer/Vector";
import WMTSCapabilities from 'ol/format/WMTSCapabilities';
import {Fill, Icon, Stroke, Style, Text} from "ol/style";
import TileSource from "ol/source/Tile";
import {Control, defaults as defaultControls} from "ol/control";
import {LineString, Point} from "ol/geom";
import { Pipe, PipeTransform } from '@angular/core';
import { NetworkStatus, RepeaterStatusService, TECHNOLOGY_ORDER } from './repeater-status.service';
import { SettingsService } from './settings.service';


//const baseUrl : String = "https://repeater.oevsv.at/api"
const baseUrl : String = "/api"
const baseMapCapabilities: string = "assets/WMTSCapabilities.xml";
const parser = new WMTSCapabilities();

/** Tight bounding box of Austria (EPSG:3857), from its westernmost point near the
 *  Bodensee (9.53°E) to the Hungarian border (17.16°E), 46.37°N to 49.02°N. The
 *  initial view is fitted to it. */
const AUSTRIA_EXTENT: Extent = olProj.transformExtent([9.53, 46.37, 17.16, 49.02], 'EPSG:4326', 'EPSG:3857');
/** Min viewport width (UIkit `@m`) treated as desktop: details float as a card on
 *  the right. Below it they are a bottom sheet. Keep in sync with the SCSS. */
const DESKTOP_BREAKPOINT = 960;
/** Width of the desktop details card incl. its margin (px), see .mdetails. */
const DETAILS_CARD_WIDTH = 420;
/** Height of the floating navigation + filter bar incl. margins (px), kept clear
 *  when fitting. See .app-nav (app.component.scss) and .mbar. */
const TOP_BAR_HEIGHT = 120;
/** Mobile: share of Austria visible initially - zoomed in slightly further than
 *  a full fit, so the edges are cut off on purpose. */
const MOBILE_VISIBLE_SHARE = 0.9;
/** URL segment for "all repeater types" (/de/all/map); the settings call that
 *  type null, which the component keeps as the string 'null'. */
const ALL_TYPES_SLUG = 'all';
/** localStorage key remembering that the "tap a repeater" hint was dismissed. */
const HINT_DISMISSED_KEY = 'frqmap.hintDismissed';

/** Teardrop pin marking a clicked / located point. A pin shape keeps it distinct
 *  from the round repeater dots (which turn green/red on selection). */
function locationPin(fill: string): Style {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">' +
    '<path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24C24 5.37 18.63 0 12 0z"' +
    ' fill="' + fill + '" stroke="#fff" stroke-width="2"/>' +
    '<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>';
  return new Style({
    image: new Icon({
      src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      anchor: [0.5, 1],
      scale: 0.8,
    }),
  });
}
/** Red pin: dropped where the user clicks a non-repeater location. */
const CLICK_MARKER_STYLE = locationPin('#d32f2f');
/** Blue pin: dropped at the user's GPS position by the "locate" button. */
const LOCATE_MARKER_STYLE = locationPin('#1565c0');
/** Label under the location pin showing the point's 6-character locator. */
function locatorLabel(locator: string): Style {
  return new Style({
    text: new Text({
      text: locator,
      font: '600 13px "Open Sans", sans-serif',
      textBaseline: 'top',
      offsetY: 6,
      fill: new Fill({ color: '#222222' }),
      backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.9)' }),
      backgroundStroke: new Stroke({ color: 'rgba(0, 0, 0, 0.2)', width: 1 }),
      padding: [2, 5, 1, 5],
    }),
  });
}
/** Blue line from the clicked / located point to a repeater picked from the
 *  nearby list, with a white casing so it stands out on the grey basemap. */
const LINK_STYLE = [
  new Style({ stroke: new Stroke({ color: '#ffffff', width: 6 }) }),
  new Style({ stroke: new Stroke({ color: '#1565c0', width: 3 }) }),
];
/* --- Repeater marker -------------------------------------------------------
 * A repeater is drawn as a transmitter-tower icon with three independently
 * colourable elements:
 *   - background:   the disc behind the tower. Partly-transparent dark grey when
 *                   idle, green when the repeater is active in a network (e.g.
 *                   OE-Link, see applyNetworkStatus()), blue when selected.
 *   - tower:        the "A" mast. Reserved for further status.
 *   - transmission: the antenna waves. Reserved for transmitting/idle status.
 * Tower and transmission start at their resting colours; updateRepeaterColors()
 * can recolour either at any time (e.g. driven by the live status poll). The
 * colours are baked into a rasterised SVG, so a colour change means building a
 * fresh Icon - hence the per-feature colour state and styleRepeater(). */

interface DiscColor { color: string; opacity: number; }

/** Background disc: partly transparent dark grey when idle. */
const REPEATER_BG_DEFAULT: DiscColor = { color: '#333333', opacity: 0.6 };
/** Background disc: blue when the repeater is selected (clicked). */
const REPEATER_BG_SELECTED: DiscColor = { color: '#1565c0', opacity: 0.9 };
/** Background disc: highlighter green when the repeater is active in a network. */
const REPEATER_BG_ONLINE: DiscColor = { color: '#39ff14', opacity: 1 };
/** Tower and waves on the highlighter green disc: dark, white/green would vanish. */
const ONLINE_FOREGROUND = '#1a1a1a';

/** Resting colours of the tower / transmission elements. */
const TOWER_DEFAULT = '#ffffff';
const TRANSMISSION_DEFAULT = '#00c853';

/** On-map size of the repeater marker (SVG is 128x128). */
const REPEATER_MARKER_SCALE = 0.15;

/** Builds the repeater tower marker SVG with the three colourable elements
 *  inlined. */
function repeaterMarkerSvg(background: DiscColor, tower: string, transmission: string): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    // background disc
    '<circle cx="64" cy="64" r="62" fill="' + background.color +
      '" fill-opacity="' + background.opacity + '"/>' +
    // transmission (antenna waves)
    '<g fill="none" stroke="' + transmission + '" stroke-width="5" stroke-linecap="round">' +
    '<circle cx="64" cy="34" r="3" fill="' + transmission + '" stroke="none"/>' +
    '<path d="M54 26 A14 14 0 0 0 54 42"/>' +
    '<path d="M74 26 A14 14 0 0 1 74 42"/>' +
    '<path d="M42 18 A28 28 0 0 0 42 50"/>' +
    '<path d="M86 18 A28 28 0 0 1 86 50"/>' +
    '</g>' +
    // tower (A-frame mast)
    '<g fill="none" stroke="' + tower + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M64 50 L40 106"/>' +
    '<path d="M64 50 L88 106"/>' +
    '<path d="M50 82 L78 82"/>' +
    '</g>' +
    '</svg>'
  );
}

/** OpenLayers style for a repeater marker with the given element colours. */
function repeaterStyle(background: DiscColor, tower: string, transmission: string): Style {
  const svg = repeaterMarkerSvg(background, tower, transmission);
  return new Style({
    image: new Icon({
      anchor: [0.5, 0.5],
      src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      scale: REPEATER_MARKER_SCALE,
    }),
  });
}

interface Site {
  site_name: string,
  city: string,
  fm: boolean,
  dmr: boolean,
  c4fm: boolean,
  dstar: boolean,
  tetra: boolean,
  digipeater: boolean,
  beacon: boolean,
  atv: boolean,
  /** Callsigns of the site's active transmitters. */
  callsigns: string[] | null,
  latitude_formated: string,
  longitude_formated: string,
  sea_level: number,
  locator_short: string,
  locator_long: string,
  geo_prefix: string,
  bev_gid: number,
  geom: object,
  st_askml: string,

  [key: string]: any
}

@Component({
  standalone: false,
  selector: 'app-frqmap',
  templateUrl: './frqmap.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./frqmap.component.scss']
})
export class FrqmapComponent implements OnInit {
  formOptions : FormOptionResponse;
  map: Map;
  currentVectorLayer: VectorLayer<VectorSource<any>> | null = null
  selectedType: String;
  selectedTypeLabel: String;
  clickedLat : number;
  clickedLong : number;
  currentOverlay : TileLayer<TileSource>
  trxInfo: TrxInformation[] | null;
  trxInfoDump: TrxInformation[] | null;
  pointInfo: PointInformation[] | null;
  /** Locator / formatted coordinates of the clicked or located point. */
  pointLocation: PointLocation | null = null;
  selectedSite: Site | null;
  selectedFeature: Feature<any>;
  sitesInfo: Site[];
  filterFrequency: String;
  filterName: String;

  // Floating UI state (see frqmap.component.html).
  filtersOpen = false;
  detailsCollapsed = false;
  showHint = !readHintDismissed();
  /** Repeater type selected by default (from /settings), to detect active filters. */
  private defaultType: String | null = null;
  /** Repeater type from the URL (/de/<type>/map), lower case; applied once the
   *  settings with the known types have loaded. */
  private routeType: string = ALL_TYPES_SLUG;
  /** Type the repeaters were last loaded for (avoids loading them twice). */
  private loadedType: String | null = null;

  // Single marker for the clicked / located point (red pin for map clicks,
  // blue pin for the locate button). Distinct from the round repeater dots.
  private readonly clickMarkerSource: VectorSource<any> = new VectorSource();
  private clickMarkerLayer: VectorLayer<VectorSource<any>> | null = null;
  private locationMarkerFeature: Feature<any> | null = null;
  /** Counts point_info requests, so a late answer can't label a newer pin. */
  private pointLocationRequest = 0;
  // Vector source holding the repeater markers, so individual markers can be
  // looked up by site name and recoloured (selection / live status).
  private siteVectorSource: VectorSource<any> | null = null;
  // Line from the location pin to the repeater picked in the nearby list (plus a
  // stand-in marker if that repeater is hidden by the current filter). Drawn
  // below the repeater markers, above the basemap.
  private readonly linkSource: VectorSource<any> = new VectorSource();
  private linkLayer: VectorLayer<VectorSource<any>> | null = null;
  /** Repeater picked in the nearby list (highlighted there and on the map). */
  highlightedSite: string | null = null;

  @ViewChild('nameInput') private nameInput?: ElementRef<HTMLInputElement>;

  /** Network status (OE-Link, ...) by callsign, from RepeaterStatusService.
   *  (A plain object: "Map" is OpenLayers' map class in this file.) */
  private networkStatus: Record<string, NetworkStatus[]> = {};
  /** Site under the mouse that has network status, shown in a tooltip. */
  hoverSite: Site | null = null;
  /** "site|CALLSIGN|technology" of every active transmitter (from trxInfoDump):
   *  a network status counts for a site only if it has a transmitter with that
   *  callsign and the network's technology (OE-Link -> an FM transmitter). */
  private siteTransmitters = new Set<string>();
  @ViewChild('statusTip', { static: true }) private statusTip!: ElementRef<HTMLElement>;
  private statusTipOverlay: Overlay | null = null;

  constructor(
    private http : HttpClient,
    private statusService : RepeaterStatusService,
    private settingsService : SettingsService,
    private route : ActivatedRoute,
    private router : Router,
    private title : Title
  ) { }

  /** Most precise locator of the clicked / located point: 20 characters, or 10
   *  from a backend without locator_20. */
  get pointLocator(): string {
    return this.pointLocation?.locator_20 ?? this.pointLocation?.locator_10 ?? '';
  }

  get hasDetails(): boolean {
    return !!this.selectedSite || !!this.pointInfo || !!this.pointLocation;
  }

  /** Any filter differs from its default (offers "Reset filters"). */
  get filtersActive(): boolean {
    return (this.defaultType !== null && this.selectedType !== this.defaultType)
      || !!this.filterFrequency || !!this.filterName;
  }

  /** The name / call sign filter is folded away but set: dot on the funnel. */
  get nameFilterActive(): boolean {
    return !!this.filterName;
  }

  toggleFilters(): void {
    this.filtersOpen = !this.filtersOpen;
    if (this.filtersOpen) {
      // The input only exists after the next change detection.
      setTimeout(() => this.nameInput?.nativeElement.focus());
    }
  }

  resetFilters(): void {
    if (this.defaultType !== null) {
      this.selectedType = this.defaultType;
    }
    this.filterFrequency = '';
    this.filterName = '';
    this.loadSites();
    this.navigateToType();
  }

  /** The type dropdown changed: show those repeaters and put the type into the
   *  URL (a new history entry, so "back" returns to the previous type). */
  onTypeSelected(): void {
    this.loadSites();
    this.navigateToType();
  }

  private navigateToType(): void {
    const slug = this.selectedType === 'null' ? ALL_TYPES_SLUG : String(this.selectedType).toLowerCase();
    if (slug !== this.routeType) {
      this.router.navigate(['/', slug, 'map']);
    }
  }

  /** Applies the type from the URL: selects it (loading its repeaters if it
   *  differs) and sets the page title. Unknown types go to /all/map; upper case
   *  in the URL is normalised to lower case. */
  private applyRouteType(): void {
    const wanted = this.routeType === ALL_TYPES_SLUG ? 'null' : this.routeType;
    const option = this.formOptions.filter.types.find((o) => String(o.type).toLowerCase() === wanted);
    if (!option) {
      this.router.navigate(['/', ALL_TYPES_SLUG, 'map'], { replaceUrl: true });
      return;
    }
    if (this.route.snapshot.paramMap.get('type') !== this.routeType) {
      this.router.navigate(['/', this.routeType, 'map'], { replaceUrl: true });
    }
    // "all" is null in the settings; the component keeps it as the string 'null'.
    const type = option.type ?? 'null';
    if (this.selectedType !== type || this.loadedType !== type) {
      this.selectedType = type;
      this.loadSites();
    }
    this.title.setTitle(type === 'null'
      ? $localize`:@@titleMap:ÖVSV repeater map`
      : $localize`:@@titleMapType:ÖVSV repeater map – ${option.label}:TYPE:`);
  }

  dismissHint(): void {
    this.showHint = false;
    try {
      localStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch {
      // storage unavailable (private mode etc.) - the hint just comes back next time
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.filtersOpen) {
      this.filtersOpen = false;
    } else if (this.hasDetails) {
      this.closeDetails();
    }
  }

  ngOnInit(): void {
    console.log("init")
    // /de/fm/map -> /de/dmr/map reuses this component, so follow the parameter
    // (also covers the browser's back / forward buttons).
    this.route.paramMap.subscribe((params) => {
      this.routeType = (params.get('type') ?? ALL_TYPES_SLUG).toLowerCase();
      if (this.formOptions) {
        this.applyRouteType();
      }
    });
    this.loadOptions()
    this.initMap()
    // Live status polling is wired up but the service is disabled until the
    // status endpoint is defined, so this is a no-op for now (markers keep their
    // default colours). See RepeaterStatusService to go live.
    this.startStatusPolling()
  }

  private initMap(): void {
    this.map = new Map({
      controls: defaultControls().extend([
        new CenterOnUserLocationControl({
          onLocate: (lonLat: number[], coordinate: Coordinate) => this.handleLocated(lonLat, coordinate),
        }),
      ]),
      view: new View({
        center: [0, 0],
        zoom: 10,
        // North stays up: a two-finger pinch to zoom would otherwise also rotate.
        enableRotation: false
      }),
      layers: [],
      target: 'map',
      pixelRatio: 1

    });
    //http://bboxfinder.com/#46.346928,9.404297,49.095452,17.144165
    this.fitAustria();

    //add basemap layers
    this.http.get(baseMapCapabilities, {
      observe: 'body',
      responseType: 'text'
    })
      .subscribe({
        next: (text) => {
          try {
            const result = parser.read(text);
            const options = optionsFromCapabilities(result, {
              layer: 'bmaphidpi',
              matrixSet: 'google3857'
            });
            // optionsFromCapabilities returns null if the layer/matrixSet is not
            // found (e.g. the request returned HTML, not the capabilities XML).
            if (!options) {
              throw new Error('optionsFromCapabilities returned null (capabilities not parsed as expected)');
            }
            options.attributions = 'Grundkarte &copy; <a href="//www.basemap.at/">' +
              'basemap.at</a>, Repeaterdaten CC-BY4.0.'

            const layer = new TileLayer({
              source: new WMTSSource(options),
              opacity: 1,
              visible: true
            })
            this.desaturate(layer);
            this.map.getLayers().insertAt(0, layer)
          } catch (err) {
            console.error('basemap: failed to build WMTS layer from capabilities, falling back to OSM', err);
            this.addFallbackBasemap();
          }
        },
        error: (err) => {
          console.error('basemap: failed to load WMTS capabilities, falling back to OSM', err);
          this.addFallbackBasemap();
        }
      });

    // Tooltip with the network status of the repeater under the mouse.
    this.statusTipOverlay = new Overlay({
      element: this.statusTip.nativeElement,
      positioning: 'bottom-center',
      offset: [0, -14],
      stopEvent: false,
    });
    this.map.addOverlay(this.statusTipOverlay);

    // change mouse cursor when over marker; show the tooltip (mouse only - on
    // touch screens the details panel shows the same on tap)
    let that = this;
    this.map.on('pointermove', function (e) {
      const pixel = that.map.getEventPixel(e.originalEvent);
      const hit = that.map.hasFeatureAtPixel(pixel);

      const target = that.map.getTargetElement();
      if (target) {
        target.style.cursor = hit ? 'pointer' : '';
      }

      let site: Site | null = null;
      let coordinate: Coordinate | undefined;
      if (!e.dragging && (e.originalEvent as PointerEvent).pointerType === 'mouse') {
        that.map.forEachFeatureAtPixel(pixel, (f) => {
          const s = (f as Feature<any>).get('site') as Site | undefined;
          if (s && that.hoverStatusesFor(s).length) {
            site = s;
            coordinate = ((f as Feature<any>).getGeometry() as Point).getCoordinates();
            return true;
          }
          return false;
        });
      }
      if (site !== that.hoverSite) {
        that.hoverSite = site;
        that.statusTipOverlay?.setPosition(coordinate);
      }
    });

    this.dumpSiteInfosForFiltering();

    this.map.on('click', (e) => {
      let coordsWgs84 = olProj.transform(e.coordinate,'EPSG:3857', 'EPSG:4326');
      console.log(e.coordinate, coordsWgs84);
      this.clickedLong = coordsWgs84[0];
      this.clickedLat = coordsWgs84[1];

      // Look for a repeater site under the cursor. Our own location pin carries no
      // `site` property, so a click on it is treated as a plain location click.
      let siteFeature: Feature<any> | null = null;
      this.map.forEachFeatureAtPixel(e.pixel, (f) => {
        if ((f as Feature<any>).getProperties().site) {
          siteFeature = f as Feature<any>;
          return true; // a repeater wins; stop here
        }
        return false;
      });

      if (this.selectedFeature) {
        //reset old, if any
        this.deselectRepeater(this.selectedFeature);
      }
      this.clearLink();

      if (siteFeature) {
        // Case A: clicked a repeater - select it (blue disc) and clear any location pin.
        this.selectedFeature = siteFeature;
        this.selectRepeater(this.selectedFeature);
        this.clearLocationMarker();
        this.openSite((siteFeature as Feature<any>).getProperties().site, e.coordinate);
      } else {
        // Case B: clicked a non-repeater location (including an existing red/blue
        // pin - which gets replaced). Drop a red pin, grow the panel and show the
        // nearest repeaters.
        this.selectedSite = null;
        this.showLocationMarker(e.coordinate, CLICK_MARKER_STYLE);
        this.loadInformationForPoint(coordsWgs84);
        this.removeOverlaySource();
        this.onDetailsOpened(e.coordinate);
      }
    })

    // The map fills the (fixed) viewport, so its size is known almost at once;
    // re-fit once after the first layout in case the target was created at 0x0.
    setTimeout(() => {
      this.map.updateSize();
      this.fitAustria();
    }, 100);
  }

  /** Fits Austria to fill the map: on wide screens its height spans the whole
   *  window, on narrower ones its width (the Bodensee may get cut off). The
   *  floating cards sit in corners Austria barely reaches, so desktop doesn't
   *  reserve room for them. On mobile the filter bar spans the full width, so the
   *  fit starts below it and zooms in a bit further (MOBILE_VISIBLE_SHARE). */
  private fitAustria(): void {
    const view = this.map.getView();
    const size = this.map.getSize();
    if (!size) {
      return;
    }
    const mobile = size[0] < DESKTOP_BREAKPOINT;
    view.fit(AUSTRIA_EXTENT, { size, padding: [mobile ? TOP_BAR_HEIGHT : 8, 8, 8, 8] });
    const resolution = view.getResolution();
    if (mobile && resolution) {
      view.setResolution(resolution * MOBILE_VISIBLE_SHARE);
    }
  }

  /** A repeater or location was clicked: show the details expanded, retire the
   *  hint and make sure the clicked point is not hidden under the panel. */
  private onDetailsOpened(coordinate: Coordinate): void {
    this.detailsCollapsed = false;
    this.filtersOpen = false;
    if (this.showHint) {
      this.dismissHint();
    }
    this.revealCoordinate(coordinate);
  }

  /** Pans the map just enough that `coordinate` sits in the part of the screen not
   *  covered by the details panel (right card on desktop, bottom sheet on mobile). */
  private revealCoordinate(coordinate: Coordinate): void {
    const size = this.map.getSize();
    const pixel = this.map.getPixelFromCoordinate(coordinate);
    if (!size || !pixel) {
      return;
    }
    const [width, height] = size;
    let target: number[];
    if (width >= DESKTOP_BREAKPOINT) {
      const freeWidth = width - DETAILS_CARD_WIDTH;
      if (pixel[0] <= freeWidth - 40) {
        return;
      }
      target = [freeWidth / 2, pixel[1]];
    } else {
      // The sheet covers up to ~60% of the height; aim for the middle of the rest.
      // Horizontally keep the pin and its locator label clear of the screen
      // edges and of the locate button on the right.
      const freeHeight = height * 0.4;
      const minX = 48;
      const maxX = width - 72;
      const x = Math.min(Math.max(pixel[0], minX), maxX);
      if (pixel[1] >= TOP_BAR_HEIGHT && pixel[1] <= freeHeight && x === pixel[0]) {
        return;
      }
      const y = pixel[1] >= TOP_BAR_HEIGHT && pixel[1] <= freeHeight
        ? pixel[1]
        : TOP_BAR_HEIGHT + (freeHeight - TOP_BAR_HEIGHT) / 2;
      target = [x, y];
    }
    const view = this.map.getView();
    const center = view.getCenter();
    const resolution = view.getResolution();
    if (!center || !resolution) {
      return;
    }
    // Map y grows northwards while pixel y grows downwards.
    view.animate({
      center: [
        center[0] + (pixel[0] - target[0]) * resolution,
        center[1] - (pixel[1] - target[1]) * resolution,
      ],
      duration: 300,
    });
  }

  /** Fallback basemap (desaturated OSM) used when the basemap.at WMTS cannot be
   *  loaded, so the map never renders without a background layer. */
  private addFallbackBasemap(): void {
    // Guard against adding it twice (e.g. error + a retry).
    if (this.map.getLayers().getLength() > 0 &&
        (this.map.getLayers().item(0) as TileLayer<TileSource>)?.get('isBasemap')) {
      return;
    }
    const layer = new TileLayer({
      source: new OSM(),
      opacity: 1,
      visible: true
    });
    layer.set('isBasemap', true);
    this.desaturate(layer);
    this.map.getLayers().insertAt(0, layer);
  }

  /** Renders a layer in grey tones only (the basemap.at tiles are coloured); the
   *  repeater markers and overlays keep their colours so they stand out. */
  private desaturate(layer: TileLayer<TileSource>): void {
    layer.on('prerender', (event) => {
      const context = event.context as CanvasRenderingContext2D | undefined;
      if (context) {
        context.filter = 'grayscale(100%)';
      }
    });
    layer.on('postrender', (event) => {
      const context = event.context as CanvasRenderingContext2D | undefined;
      if (context) {
        context.filter = 'none';
      }
    });
  }

  private loadOptions() {
    // Shared with the navigation, which lists a map page per type.
    this.settingsService.settings$
      .subscribe((response) => {
        this.formOptions = response;

        //there should be a default - select it

        // {"type": null, "label": "@all", "default": true}

        let defaultType = this.formOptions.filter.types.find(o => {
          return o.default
        })
        if (defaultType?.type === null) {
          defaultType.type = 'null';
        }
        if (defaultType) {
          this.selectedType = defaultType.type;
          this.defaultType = defaultType.type;
          console.log("Selected type set to ", this.selectedType);
        }
          //synchronize selectedTypeLabel
          let typeObj = this.formOptions.filter.types.find((o) => {
            return o.type === this.selectedType});
          if (typeObj) {
            this.selectedTypeLabel = typeObj.label;
            console.log(this.selectedTypeLabel.length);
          }
          else {
            this.selectedTypeLabel = "ALL";
          }
          console.log("label set to ", this.selectedTypeLabel);

        // The type in the URL decides which repeaters are shown (it loads them).
        this.applyRouteType()
        // after initial load update sites every 30s
        // todo, this-context is lost, thus selectedType becomes undefined
        //setInterval(this.loadSites, 5000);
      })

  }

 loadSites() {
   console.log("loadSites");
   this.loadedType = this.selectedType;
    // A filter change (repeater type / frequency / call sign) rebuilds the marker
    // set and may drop the currently selected repeater. Remove its coverage
    // overlay so a stale coverage layer doesn't linger over the refiltered map.
    this.removeOverlaySource();
    let param = this.selectedType;
    console.log("loadSites; type set to ",param);
    //synchronize selectedTypeLabel
   let typeObj = this.formOptions.filter.types.find((o) => {
     return o.type === param});
   if (typeObj) {
     this.selectedTypeLabel = typeObj.label;
     console.log(this.selectedTypeLabel.length);
   }
   else {
       this.selectedTypeLabel = "ALL";
     }
   console.log("loadsites; label set to ", this.selectedTypeLabel);

   let url='';

    if (param!='null') {
      param = param.toLocaleLowerCase()
      url = `${baseUrl}/site_type?${param}=eq.true`;
    } else
      url = `${baseUrl}/site_type`;


    console.log(url);

    this.http.get<[Site]>(url)
      .subscribe((response: Site[]) => {
        var filteredSites = this.trxInfoDump?.filter((trx) => {
          var search_term_freq = (this.filterFrequency ?? "").replaceAll(/[^0-9]/g, '');
          var haystack_freq = (trx.frequency_rx*1000 + " " + trx.frequency_tx*1000).replaceAll(/[^0-9]/g, '');

          var search_term_name = (this.filterName ?? "").toLowerCase();
          var haystack_name = (trx.callsign + " " + trx.site_name).toLowerCase();

          return haystack_freq.includes(search_term_freq) && haystack_name.includes(search_term_name);
        });

        var filteredResponse = response.filter((site) => {
          if (filteredSites) {
            var trx = filteredSites.find((trx) => {
              return trx.site_name === site.site_name
            });
            if (trx) {
              return true;
            }
          }
          return false;
        });

        this.sitesInfo = filteredResponse;
        this.drawSitesOnMap(filteredResponse)
        if (this.selectedSite)
        this.loadInformationForSite(this.selectedSite.site_name)
      })
  }

  private drawSitesOnMap(sites: Site[]) {
    //https://openlayers.org/en/latest/examples/icon.html

    // remove layer if it exists
    if (this.map.getLayers().getLength() > 1)
       this.map.getLayers().removeAt(1)

    console.log("drawsites")
    let featureList :  Collection<Feature<any>> | Feature<any>[] = [];
    sites.forEach((site) => {
      let feature = new Feature({
        geometry: new Point([site.longitude, site.latitude]).transform('EPSG:4326','EPSG:3857'),
        site: site,
        // Per-feature marker colour state so each element can be recoloured
        // independently: selection drives the background disc, while live status
        // drives the tower (online/offline) and transmission (transmitting/idle).
        selected: false,
        towerColor: TOWER_DEFAULT,
        txColor: TRANSMISSION_DEFAULT
      })
      this.styleRepeater(feature);
      feature.setId(site.site_name);
      featureList.push(feature);
    })

    if (featureList) {
      //add one vector source, which contains all icons
      const vectorSource = new VectorSource({
        features: featureList
      });
      this.siteVectorSource = vectorSource;
      this.applyNetworkStatus();
      const vectorLayer = new VectorLayer({
        source: vectorSource,
        zIndex: 2 // above the coverage overlay and the nearby-list line
      });
      this.map.set('name','icons')
      this.map.getLayers().insertAt(1, vectorLayer)
      //this.map.addLayer(vectorLayer)

    }
  }

  // obsolete
  reloadMap() : void {

    let operator = this.selectedType;
    if (operator === null || operator === "null" || operator === "default") {
      operator = "@all"
    }

    let param = this.selectedType;
    console.log(param);

    let result = this.formOptions.filter.types.find((o) => {
      return o.type === o.label
    });
    console.log("and now the result of find")
    console.log(result);

// expected output: 12


    console.log(param);
    let url='';

    if (param!='null') {
      param = param.toLocaleLowerCase()
      url = `${baseUrl}/site_type?${param}=eq.true`;
    } else
      url = `${baseUrl}/site_type`;

    console.log(url);


    console.log(this.selectedType);

    this.http.get<LayerConfiguration>(url, {
     // headers: {
     //   "Accept": "application/vnd.pgrst.object+json"
     // }
    })
      .subscribe((val) => {
        console.log(val.url)  // array vs objekt
        //this.changeOverlaySource(val.url);
      });

  }


  private loadInformationForPoint(coords : Coordinate) : void {
    let long = coords[0];
    let lat = coords[1];

    console.log("looking up",long,lat);

    this.loadPointLocation(long, lat);

    let url = `${baseUrl}/rpc/geo?x=${long}&y=${lat}`

    this.http.get<PointInformation[]>(url, {
      headers: {
        "Accept": "application/json"
      }
    })
      .subscribe((val) => {
        console.log("lookup callback received");
        // No sites within range: drop the list of a previous click.
        this.pointInfo = val.length > 0 ? val : null;
        if (val.length > 0) {

          let first = val[0];
/*

          if (this.currentVectorLayer !== null) {
            this.map.removeLayer(this.currentVectorLayer);
            this.currentVectorLayer = null;
          }

          let geojson = new GeoJSON().readFeature(first.geojson, {
            dataProjection: 'EPSG:4326', //WGS84
            featureProjection: 'EPSG:3857' //Overlay + Basemap
          });

          var vectorSource = new VectorSource({
            features: [geojson]
          });
          this.currentVectorLayer = new VectorLayer({
            source: vectorSource,
            style: new Style ({
              fill: new Fill({
                color: 'rgba(255,100,50,0.5)'
              }),
              stroke: new Stroke({
                color:'rgba(80,80,80,0.5)',
                width: 2
              })

            })

          })
          this.map.addLayer(this.currentVectorLayer);
          this.map.updateSize();

        }
        else {
          this.trxInfo = null
          if (this.currentVectorLayer !== null) {
            this.map.removeLayer(this.currentVectorLayer);
            this.currentVectorLayer = null;
          }
          console.log("unset")
          */
        }

      })
  }

  private dumpSiteInfosForFiltering() {
    let url=`${baseUrl}/trx_type`;


    this.http.get<TrxInformation[]>(url, {
      headers: {
        "Accept": "application/json"
      }
    })
      .subscribe((val) => {
        if (val.length > 0) {
          this.trxInfoDump = val
          this.siteTransmitters = new Set(val.flatMap((t) =>
            ['fm', 'dmr', 'c4fm', 'dstar', 'tetra'].filter((tech) => (t as any)[tech] === true)
              .map((tech) => `${t.site_name}|${(t.callsign ?? '').toUpperCase()}|${tech}`)));
          this.applyNetworkStatus();
        }
        else {
          this.trxInfoDump=null;
        }
      })
  }

  private loadInformationForSite(siteName : string) : void {

    // need to add current map type (e.g. "fm" - but how to get that?

    let param = this.selectedType;
    console.log(param);

    let url='';

    if (param!='null') {
      param = param.toLocaleLowerCase()

      url = `${baseUrl}/trx_type?site_name=eq.${siteName}&${param}=eq.true`
    } else
      url = `${baseUrl}/trx_type?site_name=eq.${siteName}`

    console.log(url);


    //let url = `${baseUrl}/trx_type?site_name=eq.${siteName}`

    this.http.get<TrxInformation[]>(url, {
      headers: {
        "Accept": "application/json"
      }
    })
      .subscribe((val) => {
        if (val.length > 0) {
          this.trxInfo = val

          let first = val[0];
/*
          if (this.currentVectorLayer !== null) {
            this.map.removeLayer(this.currentVectorLayer);
            this.currentVectorLayer = null;
          }

 */
        }
        else {
          this.trxInfo=null;
          this.selectedSite=null;
        }
      })
  }

  private removeOverlaySource() :void {
    if (this.currentOverlay != null) {
      this.map.removeLayer(this.currentOverlay)
    }
  }



  private changeOverlaySource(url: String) :void {
    if (this.currentOverlay != null) {
      this.map.removeLayer(this.currentOverlay)
    }

    const tileUrl = `${url}/{z}/{x}/{y}.png`;
    this.currentOverlay = new TileLayer({
      source: new XYZ({
          url: tileUrl,
          projection: olProj.get('EPSG:3857')!,
          maxZoom: 16
        }
      ),
      visible: true,
      opacity: 1.0
    });

    this.map.addLayer(this.currentOverlay);
  }



  /** Shows a site's details (radios, coverage overlay) in the panel. */
  private openSite(site: Site | null, coordinate: Coordinate): void {
    this.selectedSite = site;
    if (!site) {
      return;
    }
    const siteName = site.site_name;
    // replace spaces and slash
    const siteUrl = 'https://repeater.oevsv.at/tiles/' + siteName.replaceAll(' ', '-').replaceAll('/', '_');
    this.pointInfo = null;
    this.loadInformationForSite(siteName);
    this.changeOverlaySource(siteUrl);
    this.onDetailsOpened(coordinate);
  }

  /** Nearby list: highlights the repeater on the map, draws a blue line to it from
   *  the clicked / located point and zooms so both are visible next to the panel. */
  showNearbySite(info: PointInformation): void {
    if (this.selectedFeature) {
      this.deselectRepeater(this.selectedFeature);
    }
    this.clearLink();
    this.highlightedSite = info.site_name;

    const feature = this.siteVectorSource?.getFeatureById(info.site_name) as Feature<any> | null;
    if (feature) {
      this.selectedFeature = feature;
      this.selectRepeater(feature);
      this.linkTo((feature.getGeometry() as Point).getCoordinates(), false);
    } else if (info.longitude != null && info.latitude != null) {
      // Not on the map (filtered out); the backend sent its position.
      this.linkTo(olProj.fromLonLat([info.longitude, info.latitude]), true);
    } else {
      // Not on the map and no position in the response: look the site up.
      const url = `${baseUrl}/site_type?site_name=eq.${encodeURIComponent(info.site_name)}`;
      this.http.get<Site[]>(url).subscribe((sites) => {
        if (sites.length > 0 && this.highlightedSite === info.site_name) {
          this.linkTo(olProj.fromLonLat([sites[0]['longitude'], sites[0]['latitude']]), true);
        }
      });
    }
  }

  /** Whether a nearby site is drawn on the map (i.e. not hidden by the filter),
   *  so its details can be opened like a click on its marker. */
  isSiteOnMap(siteName: string): boolean {
    return !!this.siteVectorSource?.getFeatureById(siteName);
  }

  /** Nearby list: opens the details of the highlighted repeater, keeping the
   *  location pin and the line. */
  openNearbySite(info: PointInformation): void {
    const feature = this.siteVectorSource?.getFeatureById(info.site_name) as Feature<any> | null;
    if (feature) {
      this.openSite(feature.get('site'), (feature.getGeometry() as Point).getCoordinates());
    }
  }

  /** Draws the line from the location pin to `siteCoordinate` and fits both into
   *  the part of the map not covered by the panel. `standIn` adds a selected
   *  repeater marker for a site that is not drawn on the map. */
  private linkTo(siteCoordinate: Coordinate, standIn: boolean): void {
    if (!this.linkLayer) {
      this.linkLayer = new VectorLayer({ source: this.linkSource, zIndex: 1 });
      this.map.addLayer(this.linkLayer);
    }
    if (standIn) {
      const marker = new Feature(new Point(siteCoordinate));
      marker.setStyle(repeaterStyle(REPEATER_BG_SELECTED, TOWER_DEFAULT, TRANSMISSION_DEFAULT));
      this.linkSource.addFeature(marker);
    }
    const from = (this.locationMarkerFeature?.getGeometry() as Point | undefined)?.getCoordinates();
    if (!from) {
      this.fitCoordinates([siteCoordinate]);
      return;
    }
    const line = new Feature(new LineString([from, siteCoordinate]));
    line.setStyle(LINK_STYLE);
    this.linkSource.addFeature(line);
    this.fitCoordinates([from, siteCoordinate]);
  }

  /** Zooms / pans so all coordinates are visible in the area left free by the top
   *  bar and the details panel (right card on desktop, bottom sheet on mobile). */
  private fitCoordinates(coordinates: Coordinate[]): void {
    const size = this.map.getSize();
    if (!size) {
      return;
    }
    const margin = 64;
    let padding: number[];
    if (size[0] >= DESKTOP_BREAKPOINT) {
      padding = [TOP_BAR_HEIGHT + margin, DETAILS_CARD_WIDTH + margin, margin, margin];
    } else {
      const sheet = document.querySelector('.mdetails') as HTMLElement | null;
      const sheetHeight = sheet ? sheet.offsetHeight : size[1] * 0.6;
      padding = [TOP_BAR_HEIGHT + margin, margin, sheetHeight + margin, margin];
    }
    this.map.getView().fit(boundingExtent(coordinates), {
      size,
      padding,
      maxZoom: 14, // two nearby points would otherwise zoom in to street level
      duration: 400,
    });
  }

  private clearLink(): void {
    this.linkSource.clear();
    this.highlightedSite = null;
  }

  /** Closes the details panel: the selected site marker reverts to its normal
   *  colour and its tile overlay is removed. */
  closeDetails(): void {
    if (this.selectedFeature) {
      this.deselectRepeater(this.selectedFeature);
    }
    this.clearLink();
    this.selectedSite = null;
    this.trxInfo = null;
    this.pointInfo = null;
    this.pointLocation = null;
    this.pointLocationRequest++;
    this.removeOverlaySource();
  }

  /** Drops/replaces the single location pin at the given coordinate (EPSG:3857)
   *  with the given style (red for clicks, blue for the GPS location). */
  private showLocationMarker(coordinate: Coordinate, style: Style): void {
    if (!this.clickMarkerLayer) {
      this.clickMarkerLayer = new VectorLayer({ source: this.clickMarkerSource, zIndex: 1000 });
      this.map.addLayer(this.clickMarkerLayer);
    }
    this.clickMarkerSource.clear();
    this.locationMarkerFeature = new Feature(new Point(coordinate));
    this.locationMarkerFeature.setStyle(style);
    this.clickMarkerSource.addFeature(this.locationMarkerFeature);
  }

  private clearLocationMarker(): void {
    this.clickMarkerSource.clear();
    this.locationMarkerFeature = null;
    this.pointLocation = null;
    this.pointLocationRequest++;
  }

  /** Fetches locator and formatted coordinates of the clicked / located point
   *  (computed by the backend) and labels the pin with the 6-character locator. */
  private loadPointLocation(longitude: number, latitude: number): void {
    const request = ++this.pointLocationRequest;
    this.pointLocation = null;
    this.http.get<PointLocation>(`${baseUrl}/rpc/point_info?x=${longitude}&y=${latitude}`, {
      headers: { "Accept": "application/vnd.pgrst.object+json" }
    }).subscribe({
      next: (location) => {
        if (request !== this.pointLocationRequest) {
          return; // the user clicked elsewhere meanwhile
        }
        this.pointLocation = location;
        const pin = this.locationMarkerFeature;
        const pinStyle = pin?.getStyle();
        if (pin && pinStyle instanceof Style) {
          pin.setStyle([pinStyle, locatorLabel(location.locator_6)]);
        }
      },
      // Backend without point_info: the pin and the nearby list still work.
      error: (err) => console.warn('point_info not available', err),
    });
  }

  /** (Re)applies a repeater feature's current colours to its style. The disc is
   *  blue when selected, green when active in a network, grey otherwise; the
   *  tower and transmission colours come from the feature's own state. Call
   *  after changing any colour property. */
  private styleRepeater(feature: Feature<any>): void {
    const onlineDisc = !feature.get('selected') && feature.get('online');
    const background = feature.get('selected') ? REPEATER_BG_SELECTED
      : onlineDisc ? REPEATER_BG_ONLINE : REPEATER_BG_DEFAULT;
    const tower = onlineDisc ? ONLINE_FOREGROUND : feature.get('towerColor') ?? TOWER_DEFAULT;
    const transmission = onlineDisc ? ONLINE_FOREGROUND : feature.get('txColor') ?? TRANSMISSION_DEFAULT;
    feature.setStyle(repeaterStyle(background, tower, transmission));
  }

  /** Marks a repeater selected (blue disc). */
  private selectRepeater(feature: Feature<any>): void {
    feature.set('selected', true);
    this.styleRepeater(feature);
  }

  /** Reverts a repeater to its unselected (grey disc) state. */
  private deselectRepeater(feature: Feature<any>): void {
    feature.set('selected', false);
    this.styleRepeater(feature);
  }

  /** Recolours a single repeater's tower and/or transmission element in place,
   *  preserving its selection state. Intended for live status updates: pass the
   *  site name and the new colour(s). No-op if that site is not on the map. */
  updateRepeaterColors(siteName: string, colors: { tower?: string; transmission?: string }): void {
    const feature = this.siteVectorSource?.getFeatureById(siteName) as Feature<any> | null;
    if (!feature) {
      return;
    }
    if (colors.tower !== undefined) {
      feature.set('towerColor', colors.tower);
    }
    if (colors.transmission !== undefined) {
      feature.set('txColor', colors.transmission);
    }
    this.styleRepeater(feature);
  }

  /** Subscribes to the network status poll (every 5 minutes, see
   *  RepeaterStatusService) and recolours the markers. */
  private startStatusPolling(): void {
    this.statusService.poll().subscribe((statuses) => {
      const byCallsign: Record<string, NetworkStatus[]> = {};
      for (const status of statuses) {
        const call = status.callsign.toUpperCase();
        (byCallsign[call] ??= []).push(status);
      }
      this.networkStatus = byCallsign;
      this.applyNetworkStatus();
    });
  }

  /** Network status entries of a site's callsigns (empty if none), only for
   *  networks whose technology the site has a transmitter for with that
   *  callsign (see siteTransmitters); FM first, then DMR, ... */
  statusesFor(site: Site | null): NetworkStatus[] {
    if (!site) {
      return [];
    }
    return (site.callsigns ?? [])
      .flatMap((c) => (this.networkStatus[c.toUpperCase()] ?? []).filter((s) =>
        this.siteTransmitters.has(`${site.site_name}|${c.toUpperCase()}|${s.technology}`)))
      .sort((a, b) => technologyRank(a.technology) - technologyRank(b.technology)
        || a.network.localeCompare(b.network) || a.callsign.localeCompare(b.callsign));
  }

  /** The site's network status entries for the shown page: all of them on
   *  "all", else only the networks of that technology (FM page: OE-Link, DMR
   *  page: IPSC2). Used by the details panel and the marker colour. */
  pageStatusesFor(site: Site | null): NetworkStatus[] {
    const type = String(this.selectedType ?? 'null').toLowerCase();
    return this.statusesFor(site).filter((s) => type === 'null' || s.technology === type);
  }

  /** What the hover tooltip shows: the page's entries that are active now. */
  hoverStatusesFor(site: Site | null): NetworkStatus[] {
    return this.pageStatusesFor(site).filter((s) => s.active);
  }

  /** True if one of the site's network status entries on this page is active. */
  hasActiveStatus(site: Site | null): boolean {
    return this.hoverStatusesFor(site).length > 0;
  }

  /** Marks sites active in a network green - on "all" for any network, else only
   *  for networks of the shown technology (FM page: OE-Link, DMR page: IPSC2), so
   *  a page never turns green because of another technology. Call after new
   *  statuses, sites or type. */
  private applyNetworkStatus(): void {
    for (const feature of (this.siteVectorSource?.getFeatures() ?? []) as Feature<any>[]) {
      const online = this.hasActiveStatus(feature.get('site'));
      if (!!feature.get('online') !== online) {
        feature.set('online', online);
        this.styleRepeater(feature);
      }
    }
  }

  /** Called by the "locate" control: blue pin at the GPS position (kept blue, not
   *  turned into a repeater selection) plus the list of the nearest repeaters. */
  private handleLocated(lonLat: number[], coordinate: Coordinate): void {
    if (this.selectedFeature) {
      this.deselectRepeater(this.selectedFeature);
    }
    this.clearLink();
    this.selectedSite = null;
    this.removeOverlaySource();
    this.showLocationMarker(coordinate, LOCATE_MARKER_STYLE);
    this.loadInformationForPoint(lonLat);
    this.detailsCollapsed = false;
  }

  convertDMS(dd: number): string {
    //https://stackoverflow.com/questions/5786025/decimal-degrees-to-degrees-minutes-and-seconds-in-javascript
    var deg = dd | 0; // truncate dd to get degrees
    var frac = Math.abs(dd - deg); // get fractional part
    var min = (frac * 60) | 0; // multiply fraction by 60 and truncate
    var sec = ((frac * 3600 - min * 60)*1000|0)/1000;
    return deg + "° " + min + "' " + sec + "\"";
  }



}

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Position of a technology in TECHNOLOGY_ORDER (unknown ones last). */
function technologyRank(technology: string): number {
  const i = TECHNOLOGY_ORDER.indexOf(technology);
  return i < 0 ? TECHNOLOGY_ORDER.length : i;
}

/** "Locate me" crosshair, inlined so the control is self-contained. Uses
 *  `currentColor` so it stays visible against the control button. */
const LOCATE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"' +
  ' style="display:block;margin:auto" aria-hidden="true"' +
  ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="12" cy="12" r="3"/>' +
  '<line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>' +
  '<line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>' +
  '</svg>';

class CenterOnUserLocationControl extends Control {
  /** Called with the located point ([lon, lat] WGS84, coordinate EPSG:3857) so
   *  the component can drop the blue pin and show the nearest repeaters. */
  private readonly onLocate?: (lonLat: number[], coordinate: Coordinate) => void;

  /**
   * @param {Object} [opt_options] Control options.
   */
  constructor(opt_options? : any) {
    const options = opt_options || {};

    var button = document.createElement('button');
    button.innerHTML = LOCATE_ICON;

    const element = document.createElement('div');
    element.className = 'center-user-location ol-unselectable ol-control';

    element.appendChild(button);

    super({
      element: element,
      target: options.target,
    });

    this.onLocate = options.onLocate;

    button.addEventListener('click', this.centerMapOnUserLocation.bind(this), false);
    button.addEventListener('touchstart', this.centerMapOnUserLocation.bind(this), false);
  }

  centerMapOnUserLocation() {
    new Promise((resolve, reject) => {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((position) => {
            let coords = [position.coords.longitude, position.coords.latitude]
            resolve(coords)
          }, (error) => {
            reject(error)
          })
        } else {
          reject("Geolocation is not supported by this browser.")
        }
      }
    ).then((coords: any) => {
      console.log("Centering map to user location ", coords)
      let convertedCoords = olProj.transform(coords, 'EPSG:4326', 'EPSG:3857')
      const map = this.getMap();
      map?.getView().setCenter(convertedCoords)
      map?.getView().setZoom(14);

      // Let the component drop the blue pin and show the nearest repeaters.
      this.onLocate?.(coords, convertedCoords);
    });
  }
}



