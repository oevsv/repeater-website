import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import { RepeaterStore } from './repeater-store';

/** Side panel listing the nearest sites to a clicked location. */
@Component({
  selector: 'app-nearby-info',
  imports: [DecimalPipe],
  templateUrl: './nearby-info.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NearbyInfo {
  protected readonly store = inject(RepeaterStore);
}
