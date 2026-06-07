import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';

import { LIST_PATH } from '../app.routes';
import { MapService } from '../map/map.service';
import { FilterBar } from './filter-bar';
import { NearbyInfo } from './nearby-info';
import { RepeaterStore } from './repeater-store';
import { SiteInfo } from './site-info';

const TILES_BASE_URL = 'https://repeater.oevsv.at/tiles';

/**
 * Top-level map view. Owns the {@link RepeaterStore} and {@link MapService}
 * instances and wires map clicks to store actions and layer changes.
 */
@Component({
  selector: 'app-repeater-map',
  imports: [FilterBar, SiteInfo, NearbyInfo, RouterLink],
  templateUrl: './repeater-map.html',
  providers: [RepeaterStore, MapService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepeaterMap {
  protected readonly store = inject(RepeaterStore);
  protected readonly listPath = LIST_PATH;
  private readonly map = inject(MapService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.store.init();

    // Keep the markers in sync with the (filtered) site list.
    effect(() => this.map.drawSites(this.store.sites()));

    this.map.click$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((click) => {
      if (click.site) {
        this.store.selectSite(click.site);
        this.map.showOverlay(this.tilesUrl(click.site.site_name));
      } else {
        this.store.selectPoint(click.longitude, click.latitude);
        this.map.hideOverlay();
      }
    });

    // The map needs its target element in the DOM before it can be created.
    afterNextRender(() => {
      this.map.init('map');
      this.map.drawSites(this.store.sites());
    });

    this.destroyRef.onDestroy(() => this.map.destroy());
  }

  private tilesUrl(siteName: string): string {
    const slug = siteName.replaceAll(' ', '-').replaceAll('/', '_');
    return `${TILES_BASE_URL}/${slug}`;
  }
}
