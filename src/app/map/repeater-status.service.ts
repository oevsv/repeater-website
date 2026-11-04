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

/** Network status of one transmitter (GET /api/trx_status, view
 *  api.trx_status in repeater-db): one row per link of a transmitter to a
 *  network node (trx.networks), so a status belongs to exactly that
 *  transmitter, not to every transmitter of the callsign. */
export interface TrxStatus {
  /** The transmitter (trx.uid; trx_uid in /api/trx_type). */
  trx_uid: number;
  site_name: string;
  /** Upper case. */
  callsign: string;
  /** Network label, e.g. "OE-LINK", "SVXLink OE9". */
  network: string;
  /** The node as the network lists it ("932832", "OE9XFV-R", "OE6XDF-C"). */
  node: string;
  /** Modes the link is about (the transmitter's modes the network carries);
   *  a map page shows a status only if its technology is among them. */
  technologies: string[];
  /** Short info from the network, e.g. repeater ID and hardware. */
  text: string | null;
  /** The node is listed now (within 120 minutes). */
  active: boolean;
  /** When the node was last listed (ISO timestamp). */
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

/**
 * Loads the network status; the map polls it every 5 minutes (the scrapers run every few
 * minutes, so polling faster would not show anything new) and emits the
 * statuses. A failed request emits nothing, so the map keeps the last known
 * state instead of turning everything off.
 */
@Injectable({ providedIn: 'root' })
export class RepeaterStatusService {
  private readonly statusUrl = '/api/network_status';
  private readonly trxStatusUrl = '/api/trx_status';
  private readonly pollIntervalMs = 5 * 60 * 1000;

  constructor(private http: HttpClient) {}

  /** The current statuses, once (errors are passed on). */
  current(): Observable<NetworkStatus[]> {
    return this.http.get<NetworkStatus[]>(this.statusUrl, { headers: { Accept: 'application/json' } });
  }

  /** Emits the statuses per transmitter (api.trx_status) immediately, then
   *  every 5 minutes. Used by the map. */
  pollTrx(): Observable<TrxStatus[]> {
    return timer(0, this.pollIntervalMs).pipe(
      switchMap(() =>
        this.http
          .get<TrxStatus[]>(this.trxStatusUrl, { headers: { Accept: 'application/json' } })
          .pipe(catchError(() => EMPTY))
      )
    );
  }
}
