/**
 * Production environment.
 *
 * The app is deployed on the same origin as the API, so a root-relative
 * `/api` avoids any cross-origin requests.
 */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
};
