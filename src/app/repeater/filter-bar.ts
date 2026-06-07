import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { RepeaterStore } from './repeater-store';

/** Repeater-type selector plus free-text frequency and name/callsign filters. */
@Component({
  selector: 'app-filter-bar',
  imports: [FormsModule],
  templateUrl: './filter-bar.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterBar {
  protected readonly store = inject(RepeaterStore);
}
