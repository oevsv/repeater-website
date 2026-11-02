import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

/** Status of a repeater in a network, from the scraped status pages
 *  (GET /api/oelink_status, view api.oelink_status in repeater-db). */
export interface NetworkStatus {
  /** Upper case, as in the trx / site callsigns. */
  callsign: string;
  /** Network label shown on the map, e.g. "OE-LINK". */
  network: string;
  /** Short info from the network, e.g. repeater ID and hardware. */
  text: string;
  /** Listed in the network within the last 120 minutes. */
  active: boolean;
  /** When it was last listed (ISO timestamp). */
  last_active: string;
}

/** Technology of each network, so a status only colours the map pages it
 *  belongs to (OE-Link is FM: not shown as online on the DMR page). */
export const NETWORK_TECHNOLOGY: Record<string, string> = {
  'OE-LINK': 'fm',
};

/**
 * Polls the network status every 5 minutes (the scrapers run every few
 * minutes, so polling faster would not show anything new) and emits the
 * statuses. A failed request emits nothing, so the map keeps the last known
 * state instead of turning everything off.
 */
@Injectable({ providedIn: 'root' })
export class RepeaterStatusService {
  private readonly statusUrl = '/api/oelink_status';
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
