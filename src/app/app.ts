import { ChangeDetectionStrategy, Component } from '@angular/core';

import { RepeaterMap } from './repeater/repeater-map';

/** Application shell: page chrome (header, breadcrumbs, footer) around the map. */
@Component({
  selector: 'app-root',
  imports: [RepeaterMap],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
