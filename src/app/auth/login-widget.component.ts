import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { filter, Subscription } from 'rxjs';

import { TicketService } from '../ticket/ticket.service';

/** Shape of the JSON returned by the Node auth service at GET /me. */
interface Me {
  authenticated: boolean;
  callsign?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  sub?: string;
  /** ISO timestamp of the user's first login (users table); absent if the
   *  login could not be recorded. */
  first_seen?: string;
}

/**
 * Top-right login indicator.
 *
 * Asks the server-side login service (GET /me) who — if anyone — is logged in.
 * No tokens live in the browser: /me returns only display-safe claims, and the
 * session is carried by the HttpOnly cookie the browser sends automatically.
 *
 *   logged out -> "Login" (key icon), links to /login (handled by Node/nginx)
 *   logged in  -> user icon + callsign; clicking opens details + a logout link
 *
 * Logged in, it also shows how many submitted updates (/ticket) need the
 * user's attention: own ones staff answered, for staff also all open ones.
 * Refreshed on every page change, e.g. after reading an answer. Hidden while
 * tickets are restricted to staff and the user is none.
 */
@Component({
  standalone: false,
  selector: 'app-login-widget',
  templateUrl: './login-widget.component.html',
  styleUrls: ['./login-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LoginWidgetComponent implements OnInit, OnDestroy {
  me: Me | null = null;
  loaded = false;
  /** Tickets needing attention (0 also if they could not be counted). */
  attention = 0;
  staff = false;
  /** Tickets usable (false while restricted to staff, or not yet known). */
  ticketsEnabled = false;
  private navigation?: Subscription;

  constructor(private http: HttpClient, private tickets: TicketService, private router: Router) {}

  ngOnInit(): void {
    // /login, /logout, /me, /api are all server routes (absolute paths),
    // independent of the Angular <base href="/de/"> etc.
    this.http.get<Me>('/me', { withCredentials: true }).subscribe({
      next: (m) => {
        this.me = m;
        this.loaded = true;
        if (this.loggedIn) {
          this.countTickets();
          this.navigation = this.router.events.pipe(filter((e) => e instanceof NavigationEnd))
            .subscribe(() => this.countTickets());
        }
      },
      error: () => { this.me = { authenticated: false }; this.loaded = true; },
    });
  }

  ngOnDestroy(): void {
    this.navigation?.unsubscribe();
  }

  private countTickets(): void {
    this.tickets.whoami().subscribe({
      next: (w) => {
        this.attention = w.attention;
        this.staff = w.staff;
        this.ticketsEnabled = w.enabled;
      },
      error: () => (this.attention = 0), // no counter rather than an error
    });
  }

  get loggedIn(): boolean {
    return !!this.me && this.me.authenticated;
  }

  /** Send the user back to the current page after login. */
  get loginUrl(): string {
    const here = window.location.pathname + window.location.search;
    return '/login?returnTo=' + encodeURIComponent(here);
  }
}
