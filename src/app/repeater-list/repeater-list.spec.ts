import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { TrxInformation } from '../core/models';
import { RepeaterApiService } from '../core/repeater-api.service';
import { RepeaterList } from './repeater-list';

const TRANSCEIVERS = [
  { callsign: 'OE5XBM', site_name: 'Breitenstein', band: '70cm', frequency_tx: 438.875, fm: true, c4fm: true },
  { callsign: 'OE1ABC', site_name: 'Wien', band: '2m', frequency_tx: 145.6, fm: true },
  { callsign: 'OE3XNR', site_name: 'Nebelstein', band: '2m', frequency_tx: 145.6375, fm: true, dmr: true },
] as unknown as TrxInformation[];

const fakeApi: Partial<RepeaterApiService> = {
  getAllTransceivers: () => of(TRANSCEIVERS),
};

/** Access protected members at runtime (they exist on the JS instance). */
function createList(): any {
  TestBed.configureTestingModule({
    providers: [{ provide: RepeaterApiService, useValue: fakeApi }],
  });
  return TestBed.runInInjectionContext(() => new RepeaterList());
}

describe('RepeaterList', () => {
  let list: any;

  beforeEach(() => {
    list = createList();
  });

  it('sorts by call sign ascending by default', () => {
    expect(list.rows().map((t: TrxInformation) => t.callsign)).toEqual([
      'OE1ABC',
      'OE3XNR',
      'OE5XBM',
    ]);
  });

  it('toggles sort direction when the active column is reselected', () => {
    list.sortBy('callsign');
    expect(list.rows().map((t: TrxInformation) => t.callsign)).toEqual([
      'OE5XBM',
      'OE3XNR',
      'OE1ABC',
    ]);
  });

  it('sorts numerically by frequency', () => {
    list.sortBy('frequency_tx');
    expect(list.rows().map((t: TrxInformation) => t.frequency_tx)).toEqual([
      145.6, 145.6375, 438.875,
    ]);
  });

  it('filters by call sign, site or band (case-insensitive)', () => {
    list.filterText.set('wien');
    expect(list.rows().map((t: TrxInformation) => t.callsign)).toEqual(['OE1ABC']);
  });

  it('renders supported modes as a comma-separated label', () => {
    expect(list.modes(TRANSCEIVERS[2])).toBe('FM, DMR');
  });
});
