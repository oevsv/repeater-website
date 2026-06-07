/**
 * Default (development / local) environment.
 *
 * Uses the absolute, public API URL so the app works when surfed locally
 * (any host/port) — the backend sends permissive CORS headers. Replaced by
 * `environment.prod.ts` for production builds (see angular.json fileReplacements).
 */
export const environment = {
  production: false,
  apiBaseUrl: 'https://repeater.oevsv.at/api',
};
