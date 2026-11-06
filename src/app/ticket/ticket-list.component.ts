import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { SeoService } from '../seo.service';
import { isLoginError, loginUrl, TICKET_STATUS_LABELS, TicketService, TicketSummary } from './ticket.service';

/**
 * /ticket: submit an update (heading, text, optionally the site) and the list
 * of the user's submissions with their status. Staff see all submissions.
 * /ticket?site=<site name> pre-fills the site (link in the map's site details).
 */
@Component({
  standalone: false,
  selector: 'app-ticket-list',
  templateUrl: './ticket-list.component.html',
  styleUrls: ['./ticket.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class TicketListComponent implements OnInit {
  readonly statusLabels = TICKET_STATUS_LABELS;
  /** loading, login (not logged in), unavailable (restricted to staff), failed, ready */
  state: 'loading' | 'login' | 'unavailable' | 'failed' | 'ready' = 'loading';
  staff = false;
  tickets: TicketSummary[] = [];
  /** Staff: show the closed tickets, too. */
  showClosed = false;

  heading = '';
  body = '';
  siteName = '';
  sending = false;
  sendFailed = false;

  constructor(private ticketService: TicketService, private route: ActivatedRoute, private router: Router,
              private seo: SeoService) {}

  ngOnInit(): void {
    this.seo.setPage($localize`:@@titleTickets:Submit updates – ÖVSV repeaters`,
      $localize`:@@seoTickets:Report new or changed data of Austrian amateur radio repeaters to the ÖVSV VHF management.`);
    this.siteName = this.route.snapshot.queryParamMap.get('site') ?? '';
    this.ticketService.whoami().subscribe({
      next: (me) => {
        this.staff = me.staff;
        if (me.enabled) {
          this.load();
        } else {
          this.state = 'unavailable';
        }
      },
      error: (err) => this.fail(err),
    });
  }

  private load(): void {
    this.ticketService.list().subscribe({
      next: (t) => {
        this.tickets = t;
        this.state = 'ready';
      },
      error: (err) => this.fail(err),
    });
  }

  /** Not logged in: login, unless tickets are restricted to staff (then the
   *  page is not offered at all). */
  private fail(err: unknown): void {
    if (isLoginError(err)) {
      this.ticketService.staffOnly$.subscribe((restricted) => (this.state = restricted ? 'unavailable' : 'login'));
    } else {
      this.state = 'failed';
    }
  }

  get loginUrl(): string {
    return loginUrl();
  }

  /** The list as shown: staff without "show closed" see the open ones only. */
  get shown(): TicketSummary[] {
    return this.staff && !this.showClosed ? this.tickets.filter((t) => t.status !== 'closed') : this.tickets;
  }

  /** The user's own ticket has an answer they have not replied to. */
  hasAnswer(t: TicketSummary): boolean {
    return t.own && t.status === 'answered';
  }

  /** Staff: waiting for staff. */
  waiting(t: TicketSummary): boolean {
    return this.staff && t.status === 'open';
  }

  get canSend(): boolean {
    return !this.sending && this.heading.trim() !== '' && this.body.trim() !== '';
  }

  submit(): void {
    if (!this.canSend) {
      return;
    }
    this.sending = true;
    this.sendFailed = false;
    this.ticketService.create(this.heading.trim(), this.body, this.siteName.trim() || null).subscribe({
      next: (id) => this.router.navigate(['/ticket', id]),
      error: (err) => {
        this.sending = false;
        if (isLoginError(err)) {
          this.fail(err);
        } else {
          this.sendFailed = true;
        }
      },
    });
  }
}
