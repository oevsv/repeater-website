import { ChangeDetectionStrategy, Component, HostListener, Inject, LOCALE_ID } from '@angular/core';
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
  drawerOpen = false;

  constructor(private router: Router, @Inject(LOCALE_ID) public locale: string) {}

  /** True on the /list route. The map page is full screen (floating navigation,
   *  no footer); other pages get a solid navigation bar and a footer. */
  get isListPage(): boolean {
    return this.router.url.startsWith('/list');
  }

  /** Current page path without the locale prefix, for the language switch. */
  get pagePath(): string {
    return this.isListPage ? '/list' : '/';
  }

  @HostListener('document:keydown.escape')
  closeDrawer(): void {
    this.drawerOpen = false;
  }
}
