import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { catchError, map, Observable, of, shareReplay, switchMap } from 'rxjs';

/** Ticket status (public.ticket.status in repeater-db). */
export type TicketStatus = 'open' | 'answered' | 'closed';

/** A ticket in the list (api.ticket_list). */
export interface TicketSummary {
  id: string;
  heading: string;
  status: TicketStatus;
  site_name: string | null;
  created: string;
  updated: string;
  author_callsign: string | null;
  /** Submitted by the current user (staff also see the others' tickets). */
  own: boolean;
  messages: number;
  /** The latest message is from staff. */
  last_from_staff: boolean | null;
}

/** A message of a ticket: the submitted text or a reply. */
export interface TicketMessage {
  id: string;
  body: string;
  created: string;
  staff: boolean;
  callsign: string | null;
  own: boolean;
}

/** One ticket with its messages (api.ticket_get). */
export interface Ticket extends Omit<TicketSummary, 'messages' | 'last_from_staff'> {
  messages: TicketMessage[];
}

/** Status labels, shared by the list and the ticket page. */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: $localize`:@@ticketStatusOpen:Open`,
  answered: $localize`:@@ticketStatusAnswered:Answered`,
  closed: $localize`:@@ticketStatusClosed:Closed`,
};

/** Login page that brings the user back to the current page. */
export function loginUrl(): string {
  return '/login?returnTo=' + encodeURIComponent(window.location.pathname + window.location.search);
}

/** Not logged in (the login service answers 401 without a session). */
export function isLoginError(err: unknown): boolean {
  return err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403);
}

/**
 * Tickets (submitted updates) of the logged-in user; staff (users.staff4) see
 * and answer all. Calls the api.ticket_* database functions through the login
 * service (/api/secure/rpc/...), which adds the user's identity - the browser
 * holds no token. See repeater-db migration 2026-11-05_01_tickets.sql.
 */
@Injectable({ providedIn: 'root' })
export class TicketService {
  /** Tickets are restricted to staff (api.ticket_staff_only, no login needed).
   *  Restricted if it cannot be read. Asked once per page load. */
  readonly staffOnly$: Observable<boolean>;
  /** Show the links to /ticket: not restricted, or the user is staff. */
  readonly visible$: Observable<boolean>;

  constructor(private http: HttpClient) {
    this.staffOnly$ = this.http.get<boolean>('/api/rpc/ticket_staff_only', {
      headers: { Accept: 'application/json' },
    }).pipe(
      map((v) => v !== false),
      catchError(() => of(true)),
      shareReplay(1),
    );
    this.visible$ = this.staffOnly$.pipe(
      switchMap((restricted) => restricted
        ? this.whoami().pipe(map((w) => w.enabled), catchError(() => of(false)))
        : of(true)),
      shareReplay(1),
    );
  }

  private rpc<T>(fn: string, body: object = {}): Observable<T> {
    return this.http.post<T>(`/api/secure/rpc/${fn}`, body, {
      headers: { Accept: 'application/json' },
      withCredentials: true,
    });
  }

  /** staff: whether the current user is staff; enabled: false while tickets
   *  are restricted to staff (and the user is none); attention: tickets needing
   *  the user's attention (own answered ones, for staff also all open ones).
   *  401: not logged in. */
  whoami(): Observable<{ staff: boolean; enabled: boolean; attention: number }> {
    return this.rpc('ticket_whoami');
  }

  list(): Observable<TicketSummary[]> {
    return this.rpc('ticket_list');
  }

  /** 404: no such ticket, or not the user's. */
  get(id: string): Observable<Ticket> {
    return this.rpc('ticket_get', { id });
  }

  /** Returns the new ticket's id. */
  create(heading: string, body: string, siteName: string | null): Observable<string> {
    return this.rpc('ticket_create', { heading, body, site_name: siteName });
  }

  reply(id: string, body: string): Observable<void> {
    return this.rpc('ticket_reply', { id, body });
  }

  setStatus(id: string, status: TicketStatus): Observable<void> {
    return this.rpc('ticket_set_status', { id, status });
  }

  /** Staff only: deletes the ticket with all its messages. */
  delete(id: string): Observable<void> {
    return this.rpc('ticket_delete', { id });
  }
}
