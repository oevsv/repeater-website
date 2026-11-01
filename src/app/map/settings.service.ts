import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { FormOptionResponse } from './sample1';

/**
 * The backend settings (GET /api/settings), e.g. the repeater types offered by
 * the type filter. Loaded once per page load and shared: the map uses them for
 * its filter, the navigation for its list of map pages (/<type>/map).
 *
 * Note: the map turns the type of "all" from null into the string 'null' in
 * this shared object (see FrqmapComponent.loadOptions).
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);

  readonly settings$: Observable<FormOptionResponse> = this.http
    .get<FormOptionResponse>('/api/settings', {
      headers: { Accept: 'application/vnd.pgrst.object+json' },
    })
    .pipe(shareReplay(1));
}
