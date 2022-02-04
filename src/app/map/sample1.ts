export interface FormOptionResponse {
  filter: Filter,

  [key: string]: any
}


export interface Filter {
  types: Array<RepeaterType>,

  [key: string]: any
}

export interface RepeaterType {
  label: string,
  default: boolean,
  type: string | null
}

export interface LayerConfiguration {
  operator: string,
  reference: string,
  date: string,
  url: string

  [key: string]: any
}
/*
response to https://repeater.oevsv.at/api/rpc/geo?x=14.832389785258355&y=48.73106953793513

  [{"distance":13101,"site_name":"Nebelstein"},
    {"distance":54186,"site_name":"Frauenstaffel"},
    {"distance":72608,"site_name":"Sternstein"},
    {"distance":81145,"site_name":"Sandl"}]
  */
export interface PointInformation {
 distance: number;
 site_name: string;
}

export interface TrxInformation {
  site_name: string,
  city: string,
  fm: boolean,
  dmr: boolean,
  c4fm: boolean,
  dstar: boolean,
  tetra: boolean,
  beacon: boolean,
  digipeater: boolean,
  atv: boolean,
  band: string,
  frequency_tx: number,
  frequency_rx: number,
  ch: string,
  ch_new: string,
  callsign: string,
  antenna_heigth: string,
  sysop: string,
  url: string,
  hardware: string,
  mmdvm: string,
  solar_power: string,
  battery_power: string,
  fm_wakeup: string,
  ctcss_tx: string,
  ctcss_rx: string,
  echolink: boolean,
  echolink_id: number,
  digital_id: number,
  cc: number,
  ipsc2: boolean,
  brandmeister: boolean,
  c4fm_groups: string,
  dstar_rpt1: string,
  dstar_rpt2: string,
  other_mode_name: string,
  comment: string
}


export interface Site {
  site_name: string,
  city: string,
  fm: boolean,
  dmr: boolean,
  c4fm: boolean,
  dstar: boolean,
  tetra: boolean,
  digipeater: boolean,
  atv: boolean,
  callsigns:string[],
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



/*

response to https://repeater.oevsv.at/api/site_type?fm=eq.true


[{"site_name":"Braunau Stadt","city":"Braunau am Inn","fm":true,"dmr":null,"c4fm":null,"dstar":null,"digipeater":false,"beacon":false,"tetra":null,"atv":false,"callsigns":["OE5SIX"],"longitude":13.03791,"latitude":48.25152,"longitude_formated":"  13°  2.275'","latitude_formated":"  48° 15.091'","sea_level":353,"locator_short":"JN68MG","locator_long":"JN68MG40NI17TN32WL05","geo_prefix":"OE5","bev_gid":5302,"geom":{"type":"Point","coordinates":[1451373.5022085295,6148801.272387748]},"st_askml":"<Point><coordinates>13.03791,48.25152</coordinates></Point>"},
  {"site_name":"Breitenstein","city":"Linz","fm":true,"dmr":false,"c4fm":true,"dstar":true,"digipeater":false,"beacon":true,"tetra":false,"atv":true,"callsigns":["OE5XBM","OE5XOL"],"longitude":14.27429015,"latitude":48.4152993,"longitude_formated":"  14° 16.457'","latitude_formated":"  48° 24.918'","sea_level":955,"locator_short":"JN78DJ","locator_long":"JN78DJ29VQ91NF37MM45","geo_prefix":"OE5","bev_gid":701,"geom":{"type":"Point","coordinates":[1589006.7109334406,6176226.048010303]},"st_askml":"<Point><coordinates>14.274290149999999,48.41529929999999</coordinates></Point>"},
  {"site_name":"Zugspitze Ö","city":"Ehrwald","fm":true,"dmr":false,"c4fm":false,"dstar":false,"digipeater":true,"beacon":false,"tetra":false,"atv":false,"callsigns":["OE7XZR"],"longitude":10.9843067,"latitude":47.4211969,"longitude_formated":"  10° 59.058'","latitude_formated":"  47° 25.272'","sea_level":2936,"locator_short":"JN57LK","locator_long":"JN57LK81CC80AW75VW86","geo_prefix":"OE7","bev_gid":2557,"geom":{"type":"Point","coordinates":[1222767.428561143,6011097.172772679]},"st_askml":"<Point><coordinates>10.9843067,47.421196900000005</coordinates></Point>"}]

/*



/*
response to https://repeater.oevsv.at/api/trx_type?site_name=eq.Nebelstein&fm=eq.true

[{"site_name":"Nebelstein","fm":true,"dmr":false,"c4fm":false,"dstar":false,"beacon":false,"digipeater":false,"atv":false,"band":"2m","frequency_tx":145.6375,"frequency_rx":145.0375,"ch":"R1x","ch_new":"RV51","callsign":"OE3XNR","antenna_heigth":null,"sysop":"OE3IGW","url":"https://www.oe3xnr.eu/","hardware":null,"mmdvm":null,"solar_power":null,"battery_power":true,"fm_wakeup":null,"ctcss_tx":88.5,"ctcss_rx":null,"echolink":null,"echolink_id":null,"digital_id":null,"cc":null,"ipsc2":null,"brandmeister":null,"c4fm_groups":null,"dstar_rpt1":null,"dstar_rpt2":null,"other_mode_name":null,"comment":"OE-Link"},
 {"site_name":"Nebelstein","fm":true,"dmr":false,"c4fm":true,"dstar":false,"beacon":false,"digipeater":false,"atv":false,"band":"70cm","frequency_tx":438.875,"frequency_rx":431.275,"ch":"R79","ch_new":"RU710","callsign":"OE3XNR","antenna_heigth":null,"sysop":"OE3IGW","url":"https://www.oe3xnr.eu/","hardware":null,"mmdvm":null,"solar_power":null,"battery_power":null,"fm_wakeup":null,"ctcss_tx":88.5,"ctcss_rx":null,"echolink":null,"echolink_id":null,"digital_id":null,"cc":null,"ipsc2":null,"brandmeister":null,"c4fm_groups":"32","dstar_rpt1":null,"dstar_rpt2":null,"other_mode_name":null,"comment":null}]


 */

const sample: FormOptionResponse = {

  "uid": 1,
  "object": "settings",
  "filter": {
    "types": [
      {
        "label": "@all",
        "default": false,
        "type": null
      },
      {
        "label": "FM",
        "default": true,
        "type": "fm"
      },
      {
        "label": "DMR",
        "default": false,
        "type": "dmr"
      },
      {
        "label": "C4FM",
        "default": false,
        "type": "c4fm"
      },
      {
        "label": "Dstar",
        "default": false,
        "type": "dstar"
      },
      {
        "label": "Tetra",
        "default": false,
        "type": "tetra"
      },
      {
        "label": "Beacon",
        "default": false,
        "type": "beacon"
      },
      {
        "label": "Digipeater",
        "default": false,
        "type": "digipeater"
      },
      {
        "label": "ATV",
        "default": false,
        "type": "atv"
      }
    ]
  }
}

export default sample;

let demo: RepeaterType;
demo = {
  "label": "@all",
  "default": true,
  "type": null
};

