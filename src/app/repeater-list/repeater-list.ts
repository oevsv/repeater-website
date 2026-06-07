import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { TrxInformation } from '../core/models';
import { RepeaterApiService } from '../core/repeater-api.service';
import { ShortenUrlPipe } from '../shared/shorten-url-pipe';

type SortKey = 'callsign' | 'site_name' | 'band' | 'frequency_tx' | 'frequency_rx' | 'sysop';

/** The digital/analog modes a transceiver supports, as short labels. */
const MODE_LABELS: ReadonlyArray<readonly [keyof TrxInformation, string]> = [
  ['fm', 'FM'],
  ['dmr', 'DMR'],
  ['c4fm', 'C4FM'],
  ['dstar', 'Dstar'],
  ['tetra', 'Tetra'],
  ['beacon', 'Beacon'],
  ['atv', 'ATV'],
  ['digipeater', 'Digipeater'],
];

/** Full, sortable, filterable table of every transceiver returned by `/api/trx_type`. */
@Component({
  selector: 'app-repeater-list',
  imports: [DecimalPipe, FormsModule, RouterLink, ShortenUrlPipe],
  templateUrl: './repeater-list.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepeaterList {
  private readonly api = inject(RepeaterApiService);

  private readonly data = signal<TrxInformation[]>([]);
  protected readonly filterText = signal('');
  protected readonly sortKey = signal<SortKey>('callsign');
  protected readonly sortDir = signal<1 | -1>(1);

  /** Filtered + sorted rows shown in the table. */
  protected readonly rows = computed(() => {
    const term = this.filterText().trim().toLowerCase();
    const key = this.sortKey();
    const dir = this.sortDir();

    const filtered = term
      ? this.data().filter((trx) =>
          `${trx.callsign} ${trx.site_name} ${trx.band}`.toLowerCase().includes(term),
        )
      : this.data();

    return [...filtered].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  });

  constructor() {
    this.api.getAllTransceivers().subscribe((trx) => this.data.set(trx));
  }

  /** Toggles direction when re-selecting the active column, otherwise sorts ascending. */
  protected sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((dir) => (dir === 1 ? -1 : 1));
    } else {
      this.sortKey.set(key);
      this.sortDir.set(1);
    }
  }

  protected sortIndicator(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDir() === 1 ? ' ▲' : ' ▼';
  }

  protected modes(trx: TrxInformation): string {
    return MODE_LABELS.filter(([field]) => trx[field])
      .map(([, label]) => label)
      .join(', ');
  }
}
