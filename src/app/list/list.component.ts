import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/** One row of the /api/trx feed. Mirrors the shape used by the original
 *  oevsv-repeaterliste; extra backend fields are tolerated via the index
 *  signature (and are also used by the CSV export). */
interface Repeater {
  uid: number;
  type_of_station: string;
  band: string;
  frequency_tx: number | null;
  frequency_rx: number | null;
  ctcss_tx: number | null;
  ctcss_rx: number | null;
  ch: string | null;
  ch_new: string | null;
  callsign: string;
  antenna_heigth: number | null;
  site_name: string;
  sysop: string | null;
  url: string | null;
  hardware: string | null;
  mmdvm: boolean | null;
  solar_power: boolean | null;
  battery_power: boolean | null;
  status: string;
  fm: boolean | null;
  fm_wakeup: string | null;
  dmr: boolean | null;
  cc: number | null;
  c4fm: boolean | null;
  c4fm_groups: string | null;
  dstar: boolean | null;
  dstar_rpt1: string | null;
  dstar_rpt2: string | null;
  tetra: boolean | null;
  other_mode: boolean | null;
  other_mode_name: string | null;
  echolink: string | null;
  echolink_id: number | null;
  digital_id: string | null;
  comment: string | null;

  [key: string]: any;
}

interface TooltipItem { label: string; value: string; }

/** Field of a repeater the free-text search box matches against. */
const SEARCH_FIELDS = ['callsign', 'site_name', 'frequency_tx', 'frequency_rx', 'ctcss_tx', 'ctcss_rx'];

/** Sentinel value of the "all types" filter option (not a real station type). */
const ALL_TYPES = 'all';

/** Localised labels for the station-type filter / column. Source text is English;
 *  the German bundle (messages.de.xlf) supplies "Sprechfunk", "Baken", … */
const TYPE_TRANSLATIONS: Record<string, string> = {
  all: $localize`:@@typeAll:All types`,
  repeater_voice: $localize`:@@typeVoice:Voice`,
  beacon: $localize`:@@typeBeacon:Beacon`,
  digipeater: $localize`:@@typeDigipeater:Digipeater`,
  atv: $localize`:@@typeATV:ATV`,
};

/**
 * Sortable / filterable repeater table at /list.
 *
 * Re-implements the oevsv-repeaterliste (originally SvelteKit) on top of the
 * same /api/trx feed, using this site's UIkit styling.
 */
@Component({
  standalone: false,
  selector: 'app-list',
  templateUrl: './list.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrls: ['./list.component.scss'],
})
export class ListComponent implements OnInit {
  /** All repeaters as fetched. */
  repeaters: Repeater[] = [];
  /** The rows actually shown (after filtering + sorting). */
  filteredRepeaters: Repeater[] = [];

  // --- filter state ---------------------------------------------------------
  searchQuery = '';
  selectedType = ALL_TYPES;
  selectedBands: string[] = ['Alle'];
  selectedModes: string[] = ['Alle'];
  selectedStatus = 'active';

  // --- sort state -----------------------------------------------------------
  sortField = 'callsign';
  sortDirection = 1;

  // --- facets, derived from the data ---------------------------------------
  stationTypes: string[] = [ALL_TYPES];
  availableBands: string[] = ['Alle'];
  availableModes: string[] = ['Alle'];

  readonly typeTranslations = TYPE_TRANSLATIONS;
  readonly statusOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'Alle' },
    { value: 'active', label: 'Aktiv' },
    { value: 'inactive', label: 'Inaktiv' },
    { value: 'testing', label: 'Test' },
    { value: 'planned', label: 'Geplant' },
    { value: 'historic', label: 'Historisch' },
  ];

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.http.get<Repeater[]>('/api/trx', { headers: { Accept: 'application/json' } }).subscribe({
      next: (data) => {
        this.repeaters = data ?? [];
        this.normalize();
        this.computeFacets();
        this.applyFilters();
      },
      error: (err) => console.error('Error fetching repeater data:', err),
    });
  }

  /** Pre-computes per-row display values once, so the template doesn't rebuild
   *  them on every change-detection pass. */
  private normalize(): void {
    for (const r of this.repeaters) {
      // Some feed entries have stray whitespace around the URL (e.g. a leading
      // space). Angular's URL sanitizer rejects those and renders them as
      // "unsafe:…", breaking the link - so trim, and drop empties to null.
      if (r.url) {
        const trimmed = r.url.trim();
        r.url = trimmed.length ? trimmed : null;
      }
      r['_modes'] = this.computeModes(r);
      r['_tooltip'] = this.computeTooltip(r);
    }
  }

  /** Builds the select-box facets (types / bands / modes) from the data. */
  private computeFacets(): void {
    this.stationTypes = [ALL_TYPES, ...new Set(this.repeaters.map((r) => r.type_of_station))];
    this.availableBands = ['Alle', ...new Set(this.repeaters.map((r) => r.band))];

    const modes = new Set<string>();
    if (this.repeaters.some((r) => r.fm)) modes.add('FM');
    if (this.repeaters.some((r) => r.dmr)) modes.add('DMR');
    if (this.repeaters.some((r) => r.c4fm)) modes.add('C4FM');
    if (this.repeaters.some((r) => r.dstar)) modes.add('D-STAR');
    if (this.repeaters.some((r) => r.tetra)) modes.add('TETRA');
    if (this.repeaters.some((r) => r.echolink_id)) modes.add('ECHOLINK');
    this.repeaters
      .filter((r) => r.other_mode && r.other_mode_name)
      .forEach((r) => modes.add(r.other_mode_name as string));
    this.availableModes = ['Alle', ...modes];
  }

  /** Recomputes filteredRepeaters from the current filter + sort state. Called
   *  on every filter/sort change. */
  applyFilters(): void {
    const query = this.searchQuery.toLowerCase();

    this.filteredRepeaters = this.repeaters
      .filter((r) => {
        const haystack = SEARCH_FIELDS.map((f) => r[f]).join(' ').toLowerCase();
        const matchesSearch = haystack.includes(query);
        const matchesType = this.selectedType === ALL_TYPES || r.type_of_station === this.selectedType;
        const matchesStatus = this.selectedStatus === 'all' || r.status === this.selectedStatus;
        const matchesModes =
          this.selectedModes.length === 0 || this.selectedModes.some((m) => this.repeaterHasMode(r, m));
        const matchesBands =
          this.selectedBands.length === 0 || this.selectedBands.some((b) => b === 'Alle' || r.band === b);
        return matchesSearch && matchesType && matchesStatus && matchesModes && matchesBands;
      })
      .sort((a, b) => {
        const av = a[this.sortField] ?? '';
        const bv = b[this.sortField] ?? '';
        return (av > bv ? 1 : av < bv ? -1 : 0) * this.sortDirection;
      });
  }

  /** Localised label for a station type (falls back to the raw value). */
  typeLabel(type: string): string {
    return this.typeTranslations[type] || type;
  }

  /** Click on a column header: toggle direction if already sorted by it,
   *  otherwise sort ascending by the new field. */
  handleSort(field: string): void {
    if (this.sortField === field) {
      this.sortDirection *= -1;
    } else {
      this.sortField = field;
      this.sortDirection = 1;
    }
    this.applyFilters();
  }

  /** Exports the currently visible rows as a CSV download (no extra deps). */
  exportToCsv(): void {
    const rows = this.filteredRepeaters;
    if (rows.length === 0) {
      return;
    }
    const headers = Object.keys(rows[0]).filter((h) => !h.startsWith('_'));
    const escape = (v: any): string => {
      if (v === null || v === undefined) {
        return '';
      }
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [
      headers.join(','),
      ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'repeaters.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private repeaterHasMode(r: Repeater, mode: string): boolean {
    switch (mode) {
      case 'Alle':
        return true;
      case 'FM':
        return !!r.fm;
      case 'DMR':
        return !!r.dmr;
      case 'C4FM':
        return !!r.c4fm;
      case 'D-STAR':
        return !!r.dstar;
      case 'TETRA':
        return !!r.tetra;
      case 'ECHOLINK':
        return !!r.echolink_id;
      default:
        return r.other_mode_name === mode;
    }
  }

  private computeModes(r: Repeater): string {
    return [
      r.fm && 'FM',
      r.dmr && 'DMR',
      r.c4fm && 'C4FM',
      r.dstar && 'D-STAR',
      r.tetra && 'TETRA',
      r.other_mode && r.other_mode_name,
    ]
      .filter(Boolean)
      .join(', ');
  }

  private computeTooltip(r: Repeater): TooltipItem[] {
    const items: TooltipItem[] = [];
    if (r.sysop) items.push({ label: 'Sysop', value: r.sysop });
    if (r.hardware) items.push({ label: 'Hardware', value: r.hardware });
    if (r.mmdvm != null) items.push({ label: 'MMDVM', value: r.mmdvm ? 'Ja' : 'Nein' });
    if (r.solar_power) items.push({ label: 'Solar', value: 'Ja' });
    if (r.battery_power) items.push({ label: 'Akku', value: 'Ja' });
    if (r.antenna_heigth != null) items.push({ label: 'Antennenhöhe', value: `${r.antenna_heigth} m` });
    if (r.fm_wakeup) items.push({ label: 'FM Wakeup', value: r.fm_wakeup });
    if (r.digital_id) items.push({ label: 'Digital ID', value: r.digital_id });
    if (r.cc != null) items.push({ label: 'CC', value: String(r.cc) });
    if (r.c4fm_groups) items.push({ label: 'C4FM Groups', value: r.c4fm_groups });
    if (r.dstar_rpt1) items.push({ label: 'D-STAR RPT1', value: r.dstar_rpt1 });
    if (r.dstar_rpt2) items.push({ label: 'D-STAR RPT2', value: r.dstar_rpt2 });
    if (r.echolink) items.push({ label: 'Echolink', value: r.echolink });
    if (r.comment) items.push({ label: 'Kommentar', value: r.comment });
    return items;
  }
}
