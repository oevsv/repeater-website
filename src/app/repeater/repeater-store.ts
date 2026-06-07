import { Injectable, computed, inject, signal } from '@angular/core';

import { FormOptionResponse, PointInformation, RepeaterType, Site, TrxInformation } from '../core/models';
import { ALL_TYPES, RepeaterApiService } from '../core/repeater-api.service';

/** Removes every non-digit so frequencies can be matched loosely (e.g. "145.6" ~ "1456"). */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Signal-based state container for the repeater map.
 *
 * Holds the current selection/filter state and coordinates calls to
 * {@link RepeaterApiService}. Provided per map component instance so the
 * presentational child components can inject the same store.
 */
@Injectable()
export class RepeaterStore {
  private readonly api = inject(RepeaterApiService);

  // --- writable state -------------------------------------------------------
  private readonly _formOptions = signal<FormOptionResponse | null>(null);
  private readonly _selectedType = signal<string>(ALL_TYPES);
  private readonly _filterFrequency = signal<string>('');
  private readonly _filterName = signal<string>('');
  private readonly _sites = signal<Site[]>([]);
  private readonly _selectedSite = signal<Site | null>(null);
  private readonly _trxInfo = signal<TrxInformation[] | null>(null);
  private readonly _pointInfo = signal<PointInformation[] | null>(null);

  /** All transceivers, used as the dataset for client-side filtering. */
  private readonly _allTransceivers = signal<TrxInformation[]>([]);

  // --- public read-only views ----------------------------------------------
  readonly types = computed<RepeaterType[]>(() => this._formOptions()?.filter.types ?? []);
  readonly selectedType = this._selectedType.asReadonly();
  readonly filterFrequency = this._filterFrequency.asReadonly();
  readonly filterName = this._filterName.asReadonly();
  readonly sites = this._sites.asReadonly();
  readonly selectedSite = this._selectedSite.asReadonly();
  readonly trxInfo = this._trxInfo.asReadonly();
  readonly pointInfo = this._pointInfo.asReadonly();

  /** Loads the initial settings, sites and transceiver dataset. */
  init(): void {
    this.api.getAllTransceivers().subscribe((trx) => this._allTransceivers.set(trx));

    this.api.getSettings().subscribe((options) => {
      this._formOptions.set(options);
      const fallback = options.filter.types.find((t) => t.default);
      this._selectedType.set(fallback?.type ?? ALL_TYPES);
      this.loadSites();
    });
  }

  setSelectedType(type: string): void {
    this._selectedType.set(type);
    this.loadSites();
  }

  setFilterFrequency(value: string): void {
    this._filterFrequency.set(value);
    this.loadSites();
  }

  setFilterName(value: string): void {
    this._filterName.set(value);
    this.loadSites();
  }

  /** Selects a site (from a map marker) and loads its transceivers. */
  selectSite(site: Site): void {
    this._selectedSite.set(site);
    this._pointInfo.set(null);
    this.loadTransceiversForSite(site.site_name);
  }

  /** Handles a click on empty map space: shows the nearest sites instead. */
  selectPoint(longitude: number, latitude: number): void {
    this._selectedSite.set(null);
    this._trxInfo.set(null);
    this.api.getNearbySites(longitude, latitude).subscribe((nearby) => {
      this._pointInfo.set(nearby.length ? nearby : null);
    });
  }

  private loadSites(): void {
    const type = this._selectedType();
    this.api.getSites(type).subscribe((sites) => {
      this._sites.set(this.applyFilters(sites));
      const selected = this._selectedSite();
      if (selected) {
        this.loadTransceiversForSite(selected.site_name);
      }
    });
  }

  private loadTransceiversForSite(siteName: string): void {
    this.api.getTransceiversForSite(siteName, this._selectedType()).subscribe((trx) => {
      if (trx.length) {
        this._trxInfo.set(trx);
      } else {
        this._trxInfo.set(null);
        this._selectedSite.set(null);
      }
    });
  }

  /**
   * Narrows the site list by the free-text frequency and name/callsign filters,
   * matching against the transceiver dataset. With no active filter every site
   * is kept.
   */
  private applyFilters(sites: Site[]): Site[] {
    const freqTerm = digitsOnly(this._filterFrequency());
    const nameTerm = this._filterName().toLowerCase();
    if (!freqTerm && !nameTerm) {
      return sites;
    }

    const matchingSites = new Set(
      this._allTransceivers()
        .filter((trx) => {
          const freqHaystack = digitsOnly(`${trx.frequency_rx * 1000} ${trx.frequency_tx * 1000}`);
          const nameHaystack = `${trx.callsign} ${trx.site_name}`.toLowerCase();
          return freqHaystack.includes(freqTerm) && nameHaystack.includes(nameTerm);
        })
        .map((trx) => trx.site_name),
    );

    return sites.filter((site) => matchingSites.has(site.site_name));
  }
}
