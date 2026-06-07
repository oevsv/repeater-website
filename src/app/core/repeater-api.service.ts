import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { FormOptionResponse, PointInformation, Site, TrxInformation } from './models';

/** Sentinel used by the UI for the "all repeater types" selection. */
export const ALL_TYPES = 'null';

/**
 * Thin wrapper around the PostgREST API exposed under `/api`.
 *
 * Every method returns a cold Observable; callers decide when to subscribe.
 */
@Injectable({ providedIn: 'root' })
export class RepeaterApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';

  /** Filter options (repeater types) shown in the UI. */
  getSettings(): Observable<FormOptionResponse> {
    return this.http.get<FormOptionResponse>(`${this.baseUrl}/settings`, {
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    });
  }

  /** All sites, optionally restricted to a single repeater type. */
  getSites(type: string): Observable<Site[]> {
    return this.http.get<Site[]>(`${this.baseUrl}/site_type${this.typeQuery(type)}`);
  }

  /** Every transceiver, used as the dataset for client-side filtering. */
  getAllTransceivers(): Observable<TrxInformation[]> {
    return this.http.get<TrxInformation[]>(`${this.baseUrl}/trx_type`);
  }

  /** Transceivers for a single site, optionally restricted to a type. */
  getTransceiversForSite(siteName: string, type: string): Observable<TrxInformation[]> {
    const site = `site_name=eq.${encodeURIComponent(siteName)}`;
    const typeFilter = this.isAll(type) ? '' : `&${type.toLowerCase()}=eq.true`;
    return this.http.get<TrxInformation[]>(`${this.baseUrl}/trx_type?${site}${typeFilter}`);
  }

  /** Nearest sites to a WGS84 coordinate. */
  getNearbySites(longitude: number, latitude: number): Observable<PointInformation[]> {
    return this.http.get<PointInformation[]>(`${this.baseUrl}/rpc/geo?x=${longitude}&y=${latitude}`);
  }

  private typeQuery(type: string): string {
    return this.isAll(type) ? '' : `?${type.toLowerCase()}=eq.true`;
  }

  private isAll(type: string): boolean {
    return !type || type === ALL_TYPES;
  }
}
