import { Component, OnInit } from '@angular/core';
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


//const baseUrl : String = "https://repeater.oevsv.at/api"
const baseUrl : String = "/api"
const baseMapCapabilities: string = "assets/WMTSCapabilities.xml";
const parser = new WMTSCapabilities();
const iconImage: Style = new Style({
  image: new Icon({
    // put anchor in the middle of the icon
    anchor: [0.5, 0.5],
    // anchorXUnits: 'pixels',
    // anchorYUnits: 'pixels',
    src: 'assets/dot_red.png',
    scale: 0.7
  })
})
const iconImageSelected: Style = new Style({
  image: new Icon({
    // put anchor in the middle of the icon
    anchor: [0.5, 0.5],
    // anchorXUnits: 'pixels',
    // anchorYUnits: 'pixels',
    src: 'assets/dot_green.png',
    scale: 0.7
  })
})

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
  selector: 'app-frqmap',
  templateUrl: './frqmap.component.html',
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



  constructor(
    private http : HttpClient
  ) { }

  ngOnInit(): void {
    console.log("init")
    this.loadOptions()
    this.initMap()
  }

  private initMap(): void {
    this.map = new Map({
      controls: defaultControls().extend([new CenterOnUserLocationControl()]),
      view: new View({
        center: [0, 0],
        zoom: 10
      }),
      layers: [],
      target: 'map',
      pixelRatio: 1

    });
    //http://bboxfinder.com/#46.346928,9.404297,49.095452,17.144165
    var textent : Extent = [908071,  5751733,     2047289,       6375459];
    this.map.getView().fit(textent, {size: this.map.getSize()});

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

      //maybe there are infos for this point
      //https://openlayers.org/en/latest/examples/icon.html
      const feature = this.map.forEachFeatureAtPixel(e.pixel, function (feature) {
        return feature;
      });
      if (this.selectedFeature) {
        //reset old, of any
        this.selectedFeature.setStyle(iconImage);
      }
      let siteUrl;
      if (feature) {
        console.log("feature for icon")
        //set feature style
        this.selectedFeature = feature as Feature<any>;
        this.selectedFeature.setStyle(iconImageSelected);

        this.selectedSite = feature.getProperties().site
        if (this.selectedSite) {
          let siteName = this.selectedSite.site_name;
          // replace spaces and slash
          let siteUrl = 'https://repeater.oevsv.at/tiles/' + siteName.replaceAll(' ', '-').replaceAll('/', '_');
          console.log("Url for tiles of site", siteUrl);
          console.log("Current site", siteName)
          // remove pointInfo
          this.pointInfo = null;
          this.loadInformationForSite(siteName)
          this.changeOverlaySource(siteUrl)

        }
      } else {
        this.selectedSite = null;
        console.log("not hit - not site here");
        this.loadInformationForPoint(coordsWgs84);
        this.removeOverlaySource();
      }
    })

    let timeouts = [100, 300, 1000, 3000]
    timeouts.forEach(to => {
      setTimeout(() => {
        this.map.updateSize();
      }, to);
    })
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
        site: site
      })
      feature.setStyle(iconImage);
      feature.setId(site.site_name);
      featureList.push(feature);
    })

    if (featureList) {
      //add one vector source, which contains all icons
      const vectorSource = new VectorSource({
        features: featureList
      });
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



  convertDMS(dd: number): string {
    //https://stackoverflow.com/questions/5786025/decimal-degrees-to-degrees-minutes-and-seconds-in-javascript
    var deg = dd | 0; // truncate dd to get degrees
    var frac = Math.abs(dd - deg); // get fractional part
    var min = (frac * 60) | 0; // multiply fraction by 60 and truncate
    var sec = ((frac * 3600 - min * 60)*1000|0)/1000;
    return deg + "° " + min + "' " + sec + "\"";
  }



}

class CenterOnUserLocationControl extends Control {
  /**
   * @param {Object} [opt_options] Control options.
   */
  constructor(opt_options? : any) {
    const options = opt_options || {};

    var button = document.createElement('button');
    button.innerHTML = '&#8226;';

    const element = document.createElement('div');
    element.className = 'center-user-location ol-unselectable ol-control';

    element.appendChild(button);

    super({
      element: element,
      target: options.target,
    });

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
      this.getMap()?.getView().setCenter(convertedCoords)
      this.getMap()?.getView().setZoom(14);
    });
  }
}



