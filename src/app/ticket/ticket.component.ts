import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { SeoService } from '../seo.service';
import { isLoginError, loginUrl, Ticket, TICKET_STATUS_LABELS, TicketService, TicketStatus } from './ticket.service';

/**
 * /ticket/<uuid>: one submitted update with all messages; the author and
 * staff can reply. The author can close / reopen it, staff can set any status.
 * Replying sets the status (author: open, staff: answered).
 */
@Component({
  standalone: false,
  selector: 'app-ticket',
  templateUrl: './ticket.component.html',
  styleUrls: ['./ticket.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class TicketComponent implements OnInit, OnDestroy {
  readonly statusLabels = TICKET_STATUS_LABELS;
  readonly statuses: TicketStatus[] = ['open', 'answered', 'closed'];
  /** loading, login (not logged in), unavailable (restricted to staff), notfound (or not the user's), failed, ready */
  state: 'loading' | 'login' | 'unavailable' | 'notfound' | 'failed' | 'ready' = 'loading';
  staff = false;
  ticket: Ticket | null = null;
  reply = '';
  sending = false;
  sendFailed = false;
  private id = '';
  private sub?: Subscription;

  constructor(private ticketService: TicketService, private route: ActivatedRoute, private router: Router,
              private seo: SeoService) {}

  ngOnInit(): void {
    this.sub = this.route.paramMap.subscribe((params) => {
      this.id = params.get('id') ?? '';
      this.state = 'loading';
      this.ticket = null;
      this.seo.setPage($localize`:@@titleTicket:Submitted update – ÖVSV repeaters`,
        $localize`:@@seoTickets:Report new or changed data of Austrian amateur radio repeaters to the ÖVSV VHF management.`);
      // Not a UUID: the database would answer 400; show "not found" instead.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.id)) {
        this.state = 'notfound';
        return;
      }
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
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private load(): void {
    this.ticketService.get(this.id).subscribe({
      next: (t) => {
        this.ticket = t;
        this.state = 'ready';
      },
      error: (err) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    if (isLoginError(err)) {
      // Not logged in: login, unless tickets are restricted to staff.
      this.ticketService.staffOnly$.subscribe((restricted) => (this.state = restricted ? 'unavailable' : 'login'));
    } else if (err instanceof HttpErrorResponse && err.status === 404) {
      this.state = 'notfound';
    } else {
      this.state = 'failed';
    }
  }

  get loginUrl(): string {
    return loginUrl();
  }

  get canSend(): boolean {
    return !this.sending && this.reply.trim() !== '';
  }

  send(): void {
    if (!this.canSend) {
      return;
    }
    this.run(this.ticketService.reply(this.id, this.reply), () => (this.reply = ''));
  }

  setStatus(status: TicketStatus): void {
    this.run(this.ticketService.setStatus(this.id, status));
  }

  /** Staff: deletes the ticket with all messages (after asking), back to the list. */
  deleteTicket(): void {
    if (!confirm($localize`:@@ticketDeleteConfirm:Delete this submission with all its messages? This cannot be undone.`)) {
      return;
    }
    this.sending = true;
    this.sendFailed = false;
    this.ticketService.delete(this.id).subscribe({
      next: () => this.router.navigate(['/ticket']),
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

  /** Sends a change, then reloads the ticket (status and messages). */
  private run(request: ReturnType<TicketService['reply']>, done?: () => void): void {
    this.sending = true;
    this.sendFailed = false;
    request.subscribe({
      next: () => {
        this.sending = false;
        done?.();
        this.load();
      },
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
