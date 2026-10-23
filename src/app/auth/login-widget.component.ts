import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

/** Shape of the JSON returned by the Node auth service at GET /me. */
interface Me {
  authenticated: boolean;
  callsign?: string;
  name?: string;
  email?: string;
  email_verified?: boolean;
  sub?: string;
}

/**
 * Top-right login indicator.
 *
 * Asks the server-side auth prototype (GET /me) who — if anyone — is logged in.
 * No tokens live in the browser: /me returns only display-safe claims, and the
 * session is carried by the HttpOnly cookie the browser sends automatically.
 *
 *   logged out -> "Login" (key icon), links to /login (handled by Node/nginx)
 *   logged in  -> user icon + callsign; clicking opens details + a logout link
 */
@Component({
  standalone: false,
  selector: 'app-login-widget',
  templateUrl: './login-widget.component.html',
  styleUrls: ['./login-widget.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LoginWidgetComponent implements OnInit {
  me: Me | null = null;
  loaded = false;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    // /login, /logout, /me, /api are all server routes (absolute paths),
    // independent of the Angular <base href="/de/"> etc.
    this.http.get<Me>('/me', { withCredentials: true }).subscribe({
      next: (m) => { this.me = m; this.loaded = true; },
      error: () => { this.me = { authenticated: false }; this.loaded = true; },
    });
  }

  get loggedIn(): boolean {
    return !!this.me && this.me.authenticated;
  }
}
