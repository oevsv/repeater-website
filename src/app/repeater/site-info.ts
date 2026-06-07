import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { RepeaterStore } from './repeater-store';
import { TrxDetail } from './trx-detail';

/** Side panel showing the selected site and its transceivers. */
@Component({
  selector: 'app-site-info',
  imports: [TrxDetail],
  templateUrl: './site-info.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteInfo {
  protected readonly store = inject(RepeaterStore);
}
