import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, of, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

/** Live status of a single repeater, as returned by the (planned) status
 *  endpoint. Shape is provisional - adjust to match the backend once defined. */
export interface RepeaterStatus {
  /** Must match the site_name used to draw the repeater on the map. */
  site_name: string;
  /** Repeater reachable/operational -> drives the tower colour. */
  online: boolean;
  /** Repeater currently keyed/transmitting -> drives the transmission colour. */
  transmitting: boolean;
}

/**
 * Polls the repeater status endpoint every 3s and emits the latest statuses.
 *
 * Disabled by default: while `enabled` is false, `poll()` emits nothing and makes
 * no HTTP requests, so the markers keep their default colours. To go live, point
 * `statusUrl` at the real endpoint and set `enabled = true`.
 */
@Injectable({ providedIn: 'root' })
export class RepeaterStatusService {
  /** TODO: real status endpoint, to be defined. */
  private readonly statusUrl = '/api/repeater_status';
  /** Flip to true once `statusUrl` is live. */
  private readonly enabled = false;
  private readonly pollIntervalMs = 3000;

  constructor(private http: HttpClient) {}

  /** Emits the current repeater statuses immediately, then every 3s. Transient
   *  request errors are swallowed so the poll keeps running. */
  poll(): Observable<RepeaterStatus[]> {
    if (!this.enabled) {
      return EMPTY;
    }
    return timer(0, this.pollIntervalMs).pipe(
      switchMap(() =>
        this.http
          .get<RepeaterStatus[]>(this.statusUrl)
          .pipe(catchError(() => of<RepeaterStatus[]>([])))
      )
    );
  }
}
