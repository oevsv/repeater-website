import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  standalone: false,
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  title = 'frq-map';

  constructor(private router: Router) {}

  /** True on the /list route; only that page shows the slim header/footer (the map is full screen). */
  get isListPage(): boolean {
    return this.router.url.startsWith('/list');
  }
}
