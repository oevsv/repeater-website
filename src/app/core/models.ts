/**
 * Type definitions for the PostgREST API behind `/api`.
 *
 * Sample payloads for each endpoint are documented in `API.md`.
 */

export interface FormOptionResponse {
  filter: Filter;
  [key: string]: unknown;
}

export interface Filter {
  types: RepeaterType[];
  [key: string]: unknown;
}

export interface RepeaterType {
  label: string;
  default: boolean;
  /** `null` represents the "all repeaters" option. */
  type: string | null;
}

/** A site as returned by `/api/site_type`. */
export interface Site {
  site_name: string;
  city: string;
  fm: boolean;
  dmr: boolean;
  c4fm: boolean;
  dstar: boolean;
  tetra: boolean;
  digipeater: boolean;
  beacon: boolean;
  atv: boolean;
  callsigns: string[];
  longitude: number;
  latitude: number;
  latitude_formated: string;
  longitude_formated: string;
  sea_level: number;
  locator_short: string;
  locator_long: string;
  geo_prefix: string;
  bev_gid: number;
  geom: unknown;
  st_askml: string;
  [key: string]: unknown;
}

/** A transceiver/relay as returned by `/api/trx_type`. */
export interface TrxInformation {
  site_name: string;
  city: string;
  fm: boolean;
  dmr: boolean;
  c4fm: boolean;
  dstar: boolean;
  tetra: boolean;
  beacon: boolean;
  digipeater: boolean;
  atv: boolean;
  band: string;
  frequency_tx: number;
  frequency_rx: number;
  ch: string;
  ch_new: string;
  callsign: string;
  antenna_heigth: string;
  sysop: string;
  url: string;
  hardware: string;
  mmdvm: string;
  solar_power: string;
  battery_power: string;
  fm_wakeup: string;
  ctcss_tx: string;
  ctcss_rx: string;
  echolink: boolean;
  echolink_id: number;
  digital_id: number;
  cc: number;
  ipsc2: boolean;
  brandmeister: boolean;
  c4fm_groups: string;
  dstar_rpt1: string;
  dstar_rpt2: string;
  other_mode_name: string;
  comment: string;
}

/** Nearest sites for a clicked location, returned by `/api/rpc/geo`. */
export interface PointInformation {
  distance: number;
  site_name: string;
}
