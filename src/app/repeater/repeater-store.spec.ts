import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { FormOptionResponse, Site, TrxInformation } from '../core/models';
import { RepeaterApiService } from '../core/repeater-api.service';
import { RepeaterStore } from './repeater-store';

const SETTINGS: FormOptionResponse = {
  filter: {
    types: [
      { label: '@all', default: false, type: null },
      { label: 'FM', default: true, type: 'fm' },
    ],
  },
};

const SITES = [
  { site_name: 'Nebelstein', longitude: 14.8, latitude: 48.7 },
  { site_name: 'Breitenstein', longitude: 14.2, latitude: 48.4 },
] as unknown as Site[];

const TRANSCEIVERS = [
  { site_name: 'Nebelstein', callsign: 'OE3XNR', frequency_rx: 145.0375, frequency_tx: 145.6375 },
  { site_name: 'Breitenstein', callsign: 'OE5XBM', frequency_rx: 431.275, frequency_tx: 438.875 },
] as unknown as TrxInformation[];

/** Synchronous fake so signal state settles immediately after each call. */
const fakeApi: Partial<RepeaterApiService> = {
  getSettings: () => of(SETTINGS),
  getSites: () => of(SITES),
  getAllTransceivers: () => of(TRANSCEIVERS),
  getTransceiversForSite: (siteName: string) =>
    of(TRANSCEIVERS.filter((t) => t.site_name === siteName)),
  getNearbySites: () => of([{ distance: 13101, site_name: 'Nebelstein' }]),
};

describe('RepeaterStore', () => {
  let store: RepeaterStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [RepeaterStore, { provide: RepeaterApiService, useValue: fakeApi }],
    });
    store = TestBed.inject(RepeaterStore);
  });

  it('selects the default type and loads sites on init', () => {
    store.init();
    expect(store.selectedType()).toBe('fm');
    expect(store.types()).toHaveLength(2);
    expect(store.sites().map((s) => s.site_name)).toEqual(['Nebelstein', 'Breitenstein']);
  });

  it('filters sites by name/callsign', () => {
    store.init();
    store.setFilterName('neb');
    expect(store.sites().map((s) => s.site_name)).toEqual(['Nebelstein']);
  });

  it('filters sites by frequency', () => {
    store.init();
    store.setFilterFrequency('438.875');
    expect(store.sites().map((s) => s.site_name)).toEqual(['Breitenstein']);
  });

  it('selecting a site loads its transceivers and clears nearby info', () => {
    store.init();
    store.selectSite(SITES[0]);
    expect(store.selectedSite()?.site_name).toBe('Nebelstein');
    expect(store.trxInfo()).toHaveLength(1);
    expect(store.pointInfo()).toBeNull();
  });

  it('selecting empty space loads nearby sites and clears the selection', () => {
    store.init();
    store.selectSite(SITES[0]);
    store.selectPoint(14.83, 48.73);
    expect(store.selectedSite()).toBeNull();
    expect(store.trxInfo()).toBeNull();
    expect(store.pointInfo()).toHaveLength(1);
  });
});
