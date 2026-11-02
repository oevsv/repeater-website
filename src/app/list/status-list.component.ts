import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { forkJoin } from 'rxjs';

import { RepeaterStatusService, STATUS_LIST_TECHNOLOGIES } from '../map/repeater-status.service';
import type { NetworkStatus, Transmitter } from '../map/repeater-status.service';
import { SettingsService } from '../map/settings.service';

/** One line: a network status at a site. */
interface StatusRow extends NetworkStatus {
  site: string;
}

/**
 * /list/<technology> (fm, dmr, c4fm, dstar): the status of the repeaters in the
 * networks of that technology (api.network_status), active ones first. Like on
 * the map, a status is shown for a site only if the site has a transmitter of
 * that callsign and technology; entries without such a site (network bridges,
 * hotspots, foreign stations) are left out. The site links to /site/<callsign>.
 */
@Component({
  standalone: false,
  selector: 'app-status-list',
  templateUrl: './status-list.component.html',
  styleUrls: ['./status-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class StatusListComponent implements OnInit {
  technology = '';
  /** Label of the technology from the backend settings, e.g. "FM", "Dstar". */
  label = '';
  rows: StatusRow[] = [];
  loaded = false;
  failed = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private statusService: RepeaterStatusService,
    private settings: SettingsService,
    private title: Title,
  ) {}

  get activeCount(): number {
    return this.rows.filter((r) => r.active).length;
  }

  ngOnInit(): void {
    // /list/fm -> /list/dmr reuses this component, so follow the parameter.
    this.route.paramMap.subscribe((params) => {
      const param = params.get('technology') ?? '';
      const technology = param.toLowerCase();
      if (!STATUS_LIST_TECHNOLOGIES.includes(technology)) {
        this.router.navigate(['/list'], { replaceUrl: true });
        return;
      }
      if (param !== technology) {
        this.router.navigate(['/list', technology], { replaceUrl: true });
        return;
      }
      this.technology = technology;
      this.load();
    });
  }

  private load(): void {
    const technology = this.technology;
    this.loaded = false;
    this.failed = false;
    forkJoin({
      statuses: this.statusService.current(),
      transmitters: this.http.get<Transmitter[]>('/api/trx_type', { headers: { Accept: 'application/json' } }),
      settings: this.settings.settings$,
    }).subscribe({
      next: ({ statuses, transmitters, settings }) => {
        if (technology !== this.technology) {
          return; // switched to another list meanwhile
        }
        this.label = settings.filter.types.find((t) => t.type === technology)?.label ?? technology.toUpperCase();
        this.title.setTitle($localize`:@@titleStatusList:ÖVSV repeater status – ${this.label}:TYPE:`);
        this.rows = buildRows(statuses, transmitters, technology);
        this.loaded = true;
      },
      error: () => {
        this.failed = true;
        this.loaded = true;
      },
    });
  }
}

/** The statuses of one technology, one row per site they belong to; active
 *  first, then by site, network and callsign. */
function buildRows(statuses: NetworkStatus[], transmitters: Transmitter[], technology: string): StatusRow[] {
  const sitesByCallsign: Record<string, Set<string>> = {};
  for (const t of transmitters) {
    if (t[technology] === true && t.callsign) {
      (sitesByCallsign[t.callsign.toUpperCase()] ??= new Set()).add(t.site_name);
    }
  }
  return statuses
    .filter((s) => s.technology === technology)
    .flatMap((s) => [...(sitesByCallsign[s.callsign.toUpperCase()] ?? [])].map((site) => ({ ...s, site })))
    .sort((a, b) => Number(b.active) - Number(a.active)
      || a.site.localeCompare(b.site) || a.network.localeCompare(b.network) || a.callsign.localeCompare(b.callsign));
}
