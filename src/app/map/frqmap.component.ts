import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import sampleResponseToReq1, {
  Filter,
  FormOptionResponse,
  LayerConfiguration,
  RepeaterType,
  PointInformation,
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
import {Extent} from "ol/extent";
import {HttpClient} from "@angular/common/http";
import {Source, XYZ} from "ol/source";
import {Coordinate} from "ol/coordinate";
import VectorSource from "ol/source/Vector";
import {Collection, Feature, Overlay} from "ol";
import {GeoJSON} from "ol/format";
import VectorLayer from "ol/layer/Vector";
import WMTSCapabilities from 'ol/format/WMTSCapabilities';
import {Fill, Icon, Stroke, Style} from "ol/style";
import TileSource from "ol/source/Tile";
import {Control, defaults as defaultControls} from "ol/control";
import {Point} from "ol/geom";
import { Pipe, PipeTransform } from '@angular/core';
import { RepeaterStatusService } from './repeater-status.service';


//const baseUrl : String = "https://repeater.oevsv.at/api"
const baseUrl : String = "/api"
const baseMapCapabilities: string = "assets/WMTSCapabilities.xml";
const parser = new WMTSCapabilities();

/** Austria-wide extent (EPSG:3857) used as the initial view. */
const AUSTRIA_EXTENT: Extent = [908071, 5751733, 2047289, 6375459];
/** Min viewport width (UIkit `@m`) treated as desktop. */
const DESKTOP_BREAKPOINT = 960;
/** On desktop the initial view starts 20% more zoomed in than the full-country fit. */
const DESKTOP_INITIAL_ZOOM_FACTOR = 1.2;

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
/* --- Repeater marker -------------------------------------------------------
 * A repeater is drawn as a transmitter-tower icon with three independently
 * colourable elements:
 *   - background:   the disc behind the tower. Partly-transparent dark grey when
 *                   idle, blue when the repeater is selected (this replaces the
 *                   former red -> green dot transition).
 *   - tower:        the "A" mast. Reserved for online/offline status.
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

/** Resting colours of the tower / transmission elements. */
const TOWER_DEFAULT = '#ffffff';
const TRANSMISSION_DEFAULT = '#00c853';

/** Status -> colour mapping for the planned live status poll. Placeholder
 *  colours; tune once the status endpoint and its semantics are finalised. */
const TOWER_ONLINE = '#ffffff';
const TOWER_OFFLINE = '#e53935';        // red
const TRANSMISSION_ACTIVE = '#00c853';  // green
const TRANSMISSION_IDLE = '#9e9e9e';    // grey

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
  callsigns: object,
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
  selectedSite: Site | null;
  selectedFeature: Feature<any>;
  sitesInfo: Site[];
  filterFrequency: String;
  filterName: String;

  // Single marker for the clicked / located point (red pin for map clicks,
  // blue pin for the locate button). Distinct from the round repeater dots.
  private readonly clickMarkerSource: VectorSource<any> = new VectorSource();
  private clickMarkerLayer: VectorLayer<VectorSource<any>> | null = null;
  private locationMarkerFeature: Feature<any> | null = null;
  // Vector source holding the repeater markers, so individual markers can be
  // looked up by site name and recoloured (selection / live status).
  private siteVectorSource: VectorSource<any> | null = null;

  constructor(
    private http : HttpClient,
    private statusService : RepeaterStatusService
  ) { }

  ngOnInit(): void {
    console.log("init")
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
        zoom: 10
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
      .subscribe((text) => {
        const result = parser.read(text);
        const options = optionsFromCapabilities(result, {
          layer: 'bmaphidpi',
          matrixSet: 'google3857'
        })!
        options.attributions = 'Grundkarte &copy; <a href="//www.basemap.at/">' +
          'basemap.at</a>, Repeaterdaten CC-BY4.0.'

        const layer = new TileLayer({
          source: new WMTSSource(options!),
          opacity: 1,
          visible: true
        })
        this.desaturate(layer);
        this.map.getLayers().insertAt(0, layer)
        //this.map.addLayer(layer);
      });

    // change mouse cursor when over marker
    let that = this;
    this.map.on('pointermove', function (e) {
      const pixel = that.map.getEventPixel(e.originalEvent);
      const hit = that.map.hasFeatureAtPixel(pixel);

      that.map.getTargetElement().style.cursor = hit ? 'pointer' : '';
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

      if (siteFeature) {
        // Case A: clicked a repeater - select it (blue disc) and clear any location pin.
        this.selectedFeature = siteFeature;
        this.selectRepeater(this.selectedFeature);
        this.selectedSite = (siteFeature as Feature<any>).getProperties().site;
        if (this.selectedSite) {
          let siteName = this.selectedSite.site_name;
          // replace spaces and slash
          let siteUrl = 'https://repeater.oevsv.at/tiles/' + siteName.replaceAll(' ', '-').replaceAll('/', '_');
          this.pointInfo = null;
          this.clearLocationMarker();
          this.loadInformationForSite(siteName)
          this.changeOverlaySource(siteUrl)
          this.scheduleMapResize()
        }
      } else {
        // Case B: clicked a non-repeater location (including an existing red/blue
        // pin - which gets replaced). Drop a red pin, grow the panel and show the
        // nearest repeaters.
        this.selectedSite = null;
        this.showLocationMarker(e.coordinate, CLICK_MARKER_STYLE);
        this.loadInformationForPoint(coordsWgs84);
        this.removeOverlaySource();
        this.scheduleMapResize();
      }
    })

    // The container is often still laying out right after creation, so the first
    // fit used a stale size; re-fit once it has its real size so Austria fills the
    // map instead of sitting in a band of empty space.
    let timeouts = [100, 300, 1000, 3000]
    timeouts.forEach(to => {
      setTimeout(() => {
        this.map.updateSize();
        this.fitAustria();
      }, to);
    })
  }

  /** Fits the Austria-wide extent to the current map size. On desktop the view
   *  then zooms in 20% so it starts a bit closer than the full-country overview. */
  private fitAustria(): void {
    const view = this.map.getView();
    view.fit(AUSTRIA_EXTENT, { size: this.map.getSize() });
    if (window.innerWidth >= DESKTOP_BREAKPOINT) {
      const resolution = view.getResolution();
      if (resolution) {
        view.setResolution(resolution / DESKTOP_INITIAL_ZOOM_FACTOR);
      }
    }
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
    let url = `${baseUrl}/settings`;
    this.http.get<FormOptionResponse>(url,
      {
        headers: {
          "Accept": "application/vnd.pgrst.object+json"
        }})
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

        this.loadSites()
        // after initial load update sites every 30s
        // todo, this-context is lost, thus selectedType becomes undefined
        //setInterval(this.loadSites, 5000);
      })

  }

 loadSites() {
   console.log("loadSites");
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
      const vectorLayer = new VectorLayer({
        source: vectorSource
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

    let url = `${baseUrl}/rpc/geo?x=${long}&y=${lat}`

    this.http.get<PointInformation[]>(url, {
      headers: {
        "Accept": "application/json"
      }
    })
      .subscribe((val) => {
        console.log("lookup callback received");
        if (val.length > 0) {
          this.pointInfo = val

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



  /** Closes the info panel: the right column animates back to 1/5 with the intro
   *  text, the selected site marker reverts to its normal colour, and its tile
   *  overlay is removed. */
  closeDetails(): void {
    if (this.selectedFeature) {
      this.deselectRepeater(this.selectedFeature);
    }
    this.selectedSite = null;
    this.trxInfo = null;
    this.pointInfo = null;
    this.removeOverlaySource();
    this.scheduleMapResize();
  }

  /** Keeps the OpenLayers canvas in sync with the panel's width animation. */
  private scheduleMapResize(): void {
    for (const delay of [0, 100, 200, 300, 400, 500]) {
      setTimeout(() => this.map.updateSize(), delay);
    }
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
  }

  /** (Re)applies a repeater feature's current colours to its style. The disc is
   *  blue when selected, grey otherwise; the tower and transmission colours come
   *  from the feature's own state. Call after changing any colour property. */
  private styleRepeater(feature: Feature<any>): void {
    const background = feature.get('selected') ? REPEATER_BG_SELECTED : REPEATER_BG_DEFAULT;
    const tower = feature.get('towerColor') ?? TOWER_DEFAULT;
    const transmission = feature.get('txColor') ?? TRANSMISSION_DEFAULT;
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

  /** Subscribes to the live status poll: every 3s each repeater's tower colour is
   *  updated from its online/offline state and its transmission colour from its
   *  transmitting/idle state. While the status service is disabled this completes
   *  immediately without doing anything (see RepeaterStatusService). */
  private startStatusPolling(): void {
    this.statusService.poll().subscribe((statuses) => {
      for (const status of statuses) {
        this.updateRepeaterColors(status.site_name, {
          tower: status.online ? TOWER_ONLINE : TOWER_OFFLINE,
          transmission: status.transmitting ? TRANSMISSION_ACTIVE : TRANSMISSION_IDLE,
        });
      }
    });
  }

  /** Called by the "locate" control: blue pin at the GPS position (kept blue, not
   *  turned into a repeater selection) plus the list of the nearest repeaters. */
  private handleLocated(lonLat: number[], coordinate: Coordinate): void {
    if (this.selectedFeature) {
      this.deselectRepeater(this.selectedFeature);
    }
    this.selectedSite = null;
    this.removeOverlaySource();
    this.showLocationMarker(coordinate, LOCATE_MARKER_STYLE);
    this.loadInformationForPoint(lonLat);
    this.scheduleMapResize();
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



