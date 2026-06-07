import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { TrxInformation } from '../core/models';
import { ShortenUrlPipe } from '../shared/shorten-url-pipe';

/** Renders the parameter table for a single transceiver. */
@Component({
  selector: 'app-trx-detail',
  imports: [DecimalPipe, ShortenUrlPipe],
  templateUrl: './trx-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrxDetail {
  readonly trx = input.required<TrxInformation>();
}
