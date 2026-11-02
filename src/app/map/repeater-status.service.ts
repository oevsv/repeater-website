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

/** Order of the technologies in the status lists: FM first. */
export const TECHNOLOGY_ORDER = ['fm', 'dmr', 'c4fm', 'dstar', 'tetra'];

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
