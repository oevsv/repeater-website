import { ChangeDetectionStrategy, Component, HostListener, Inject, LOCALE_ID } from '@angular/core';
import { Router } from '@angular/router';
import { SettingsService } from './map/settings.service';
import { SeoService } from './seo.service';
import { STATUS_LIST_TECHNOLOGIES } from './map/repeater-status.service';
import { TicketService } from './ticket/ticket.service';

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
  /** One map page per repeater type (/<slug>/map), from the backend settings. */
  mapTypes: { slug: string; label: string }[] = [];
  /** Links to /ticket: hidden while tickets are restricted to staff. */
  readonly ticketsVisible$ = this.tickets.visible$;

  // SeoService is created here so it sees the first navigation already.
  constructor(private router: Router, @Inject(LOCALE_ID) public locale: string, settings: SettingsService,
              _seo: SeoService, private tickets: TicketService) {
    settings.settings$.subscribe((s) => {
      this.mapTypes = s.filter.types.map((t) =>
        // "all" is null in the settings (the map turns it into 'null').
        t.type === null || t.type === 'null'
          ? { slug: 'all', label: $localize`:@@allTypes:All repeater` }
          : { slug: t.type.toLowerCase(), label: t.label });
    });
  }

  /** Status lists (/list/<technology>) for the technologies with a network. */
  get statusLists(): { slug: string; label: string }[] {
    return this.mapTypes.filter((t) => STATUS_LIST_TECHNOLOGIES.includes(t.slug));
  }

  /** Technology of the current status list (/list/fm -> "fm"), else null. */
  get currentStatusList(): string | null {
    const m = this.router.url.match(/^\/list\/([^/?#]+)/);
    return m ? m[1].toLowerCase() : null;
  }

  /** Repeater type of the current map page (/fm/map -> "fm"), else null. */
  get currentMapType(): string | null {
    const m = this.router.url.match(/^\/([^/?#]+)\/map(?:[/?#]|$)/);
    return m ? m[1].toLowerCase() : null;
  }

  /** True on a list page (/list, /list/fm, /networks, /ticket). Map pages are full
   *  screen (floating navigation, no footer); list pages get a solid
   *  navigation bar and a footer. */
  get isListPage(): boolean {
    return /^\/(?:(?:[^/?#]+\/)?list|networks|ticket)(?:[/?#]|$)/.test(this.router.url);
  }

  /** True on /networks. */
  get isNetworksPage(): boolean {
    return /^\/networks(?:[/?#]|$)/.test(this.router.url);
  }

  /** True on /ticket and /ticket/<uuid>. */
  get isTicketPage(): boolean {
    return /^\/ticket(?:[/?#]|$)/.test(this.router.url);
  }

  /** Current page path without the locale prefix (e.g. /fm/map), so the
   *  language switch stays on the same page. */
  get pagePath(): string {
    return this.router.url.split(/[?#]/)[0];
  }

  @HostListener('document:keydown.escape')
  closeDrawer(): void {
    this.drawerOpen = false;
  }
}
