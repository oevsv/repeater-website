import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

/** Status of a repeater in a network, from the scraped status pages
 *  (GET /api/network_status, view api.network_status in repeater-db). */
export interface NetworkStatus {
  /** Upper case, as in the trx / site callsigns. */
  callsign: string;
  /** Network label shown on the map, e.g. "OE-LINK", "IPSC2". */
  network: string;
  /** Technology of the network ("fm", "dmr", ...), as the trx flags / map pages:
   *  a status only counts for transmitters of that technology, and only colours
   *  its own map page (and "all"). */
  technology: string;
  /** Short info from the network, e.g. repeater ID and hardware. */
  text: string;
  /** Listed in the network within the last 120 minutes. */
  active: boolean;
  /** When it was last listed (ISO timestamp). */
  last_active: string;
}

/** Order of the technologies in the status lists: FM first. Same names as the
 *  trx flags (fm, dmr, ...) and the map pages (/fm/map, ...). */
export const TECHNOLOGY_ORDER = ['fm', 'dmr', 'c4fm', 'dstar', 'tetra'];

/** Technologies with a status list (/list/<technology>): those with a network. */
export const STATUS_LIST_TECHNOLOGIES = ['fm', 'dmr', 'c4fm', 'dstar', 'tetra'];

/** A transmitter as far as status matching needs it (from /api/trx_type). */
export interface Transmitter {
  site_name: string;
  callsign: string;
  [technologyFlag: string]: any;
}

/** Key of "this site has a transmitter with this callsign and technology". A
 *  network status counts for a site only if this key exists, e.g. an OE-Link
 *  (FM) status only for a site with an FM transmitter of that callsign. */
export function transmitterKey(siteName: string, callsign: string, technology: string): string {
  return `${siteName}|${(callsign ?? '').toUpperCase()}|${technology}`;
}

/** transmitterKey() of every technology of every transmitter. */
export function transmitterIndex(transmitters: Transmitter[]): Set<string> {
  return new Set(transmitters.flatMap((t) =>
    TECHNOLOGY_ORDER.filter((tech) => t[tech] === true).map((tech) => transmitterKey(t.site_name, t.callsign, tech))));
}

/**
 * Polls the network status every 5 minutes (the scrapers run every few
 * minutes, so polling faster would not show anything new) and emits the
 * statuses. A failed request emits nothing, so the map keeps the last known
 * state instead of turning everything off.
 */
@Injectable({ providedIn: 'root' })
export class RepeaterStatusService {
  private readonly statusUrl = '/api/network_status';
  private readonly pollIntervalMs = 5 * 60 * 1000;

  constructor(private http: HttpClient) {}

  /** The current statuses, once (errors are passed on). */
  current(): Observable<NetworkStatus[]> {
    return this.http.get<NetworkStatus[]>(this.statusUrl, { headers: { Accept: 'application/json' } });
  }

  /** Emits the current statuses immediately, then every 5 minutes. */
  poll(): Observable<NetworkStatus[]> {
    return timer(0, this.pollIntervalMs).pipe(
      switchMap(() =>
        this.http
          .get<NetworkStatus[]>(this.statusUrl, { headers: { Accept: 'application/json' } })
          .pipe(catchError(() => EMPTY))
      )
    );
  }
}
