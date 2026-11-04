import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';

import { SettingsService } from '../map/settings.service';
import { TECHNOLOGY_ORDER } from '../map/repeater-status.service';
import { SeoService } from '../seo.service';

/** A monitored network (api.networks). */
interface Network {
  id: string;
  label: string;
  url: string | null;
  technologies: string[];
  sort: number;
  linked: number;
  listed_now: number;
}

/** A transmitter linked to a network node (api.trx_network, from trx.networks). */
interface TrxNetwork {
  trx_uid: number;
  network_id: string;
  node: string;
  site_name: string;
  callsign: string;
  frequency_tx: number | null;
  technologies: string[];
  node_frequency: number | null;
  last_listed: string | null;
  listed_now: boolean;
  /** ircDDB: the gateway's latest listing says Offline. */
  offline: boolean;
}

/** A transmitter that could be meant by an unlinked node. */
interface Candidate {
  trx_uid: number;
  site_name: string;
  frequency_tx: number | null;
  technologies: string[];
  fits: boolean;
  excluded: boolean;
  linked_node: string | null;
}

/** A node listed by a network but linked to no transmitter (api.network_unlinked). */
interface UnlinkedNode {
  network_id: string;
  node: string;
  callsign: string;
  node_frequency: number | null;
  last_listed: string;
  offline: boolean;
  candidates: Candidate[];
}

/** One network with its links and open nodes, as shown. */
interface NetworkView extends Network {
  links: TrxNetwork[];
  unlinked: UnlinkedNode[];
}

/**
 * /networks: the monitored networks (OE-LINK, SVXLink OE9, IPSC2, ...), each
 * with a link to its dashboard, the transmitters linked to it (trx.networks in
 * repeater-db) and the nodes it lists that are not linked to a transmitter yet
 * (work list for manual linking).
 */
@Component({
  standalone: false,
  selector: 'app-networks',
  templateUrl: './networks.component.html',
  styleUrls: ['./networks.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class NetworksComponent implements OnInit {
  networks: NetworkView[] = [];
  loaded = false;
  failed = false;
  /** Mode labels from the backend settings (fm -> "FM", dstar -> "Dstar"). */
  private labels: Record<string, string> = {};

  constructor(private http: HttpClient, private settings: SettingsService, private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setPage($localize`:@@titleNetworks:ÖVSV repeater networks`,
      $localize`:@@seoNetworks:Which Austrian amateur radio repeaters are linked to which network (OE-LINK, SVXLink, IPSC2, YCS232, D-STAR, TETRA), with node, frequency and when each was last listed.`);
    const json = { headers: { Accept: 'application/json' } };
    forkJoin({
      networks: this.http.get<Network[]>('/api/networks?order=sort', json),
      links: this.http.get<TrxNetwork[]>('/api/trx_network?order=site_name,frequency_tx', json),
      unlinked: this.http.get<UnlinkedNode[]>('/api/network_unlinked?order=node', json),
      settings: this.settings.settings$,
    }).subscribe({
      next: ({ networks, links, unlinked, settings }) => {
        for (const t of settings.filter.types) {
          if (t.type) {
            this.labels[String(t.type).toLowerCase()] = t.label;
          }
        }
        this.networks = networks.map((n) => ({
          ...n,
          links: links.filter((l) => l.network_id === n.id),
          unlinked: unlinked.filter((u) => u.network_id === n.id),
        }));
        this.loaded = true;
      },
      error: () => {
        this.failed = true;
        this.loaded = true;
      },
    });
  }

  /** "FM, Tetra" - the modes in the website's order with their labels. */
  modes(technologies: string[] | null): string {
    return [...(technologies ?? [])]
      .sort((a, b) => TECHNOLOGY_ORDER.indexOf(a) - TECHNOLOGY_ORDER.indexOf(b))
      .map((t) => this.labels[t] ?? t.toUpperCase())
      .join(', ');
  }

  /** Jump link: scrolls to a network's section (plain #anchors would go
   *  through the router and drop the language prefix). */
  scrollTo(id: string): void {
    document.getElementById('network-' + id)?.scrollIntoView({ behavior: 'smooth' });
  }

  /** Total of nodes waiting for a manual link. */
  get unlinkedCount(): number {
    return this.networks.reduce((sum, n) => sum + n.unlinked.length, 0);
  }
}
