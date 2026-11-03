import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';

/** Public address of the website; canonical and hreflang links always point
 *  here (also when testing on another host), like the sitemap does. */
export const SITE_ORIGIN = 'https://repeater.oevsv.at';
/** Languages of the website, one bundle each (/de/..., /en/...). */
const LANGUAGES = ['de', 'en'];

/**
 * Search engine information of the current page: title, description, canonical
 * link, hreflang links to the other language and the Open Graph tags (link
 * previews). Pages call setPage(); the canonical path is the current route
 * (without query and fragment) unless a page names another one, e.g. a site
 * page reached through a second callsign of that site.
 *
 * The sitemap (/sitemap.xml) is served by the backend: api.sitemap() in
 * repeater-db.
 */
@Injectable({ providedIn: 'root' })
export class SeoService {
  private canonicalPath: string | null = null;

  constructor(
    private title: Title,
    private meta: Meta,
    private router: Router,
    @Inject(DOCUMENT) private document: Document,
  ) {
    router.events.pipe(filter((e) => e instanceof NavigationStart)).subscribe(() => {
      this.canonicalPath = null; // set again by the next page if it needs one
    });
    router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.updateLinks());
  }

  /** Title and description of the page; canonicalPath without language prefix,
   *  e.g. /site/OE3XNR (default: the current route). */
  setPage(title: string, description: string, canonicalPath?: string): void {
    this.title.setTitle(title);
    this.setMeta('name', 'description', description);
    this.setMeta('property', 'og:title', title);
    this.setMeta('property', 'og:description', description);
    if (canonicalPath !== undefined) {
      this.canonicalPath = canonicalPath;
    }
    this.updateLinks();
  }

  /** Canonical link, og:url and the hreflang alternates for the current path. */
  private updateLinks(): void {
    const path = this.canonicalPath ?? this.router.url.split(/[?#]/)[0];
    const lang = this.document.documentElement.lang?.slice(0, 2) || 'de';
    const url = (l: string) => `${SITE_ORIGIN}/${l}${path === '/' ? '/' : path}`;
    this.setLink('canonical', null, url(lang));
    for (const l of LANGUAGES) {
      this.setLink('alternate', l, url(l));
    }
    this.setMeta('property', 'og:url', url(lang));
    this.setMeta('property', 'og:locale', lang === 'de' ? 'de_AT' : 'en_GB');
  }

  private setMeta(attr: 'name' | 'property', key: string, content: string): void {
    this.meta.updateTag({ [attr]: key, content }, `${attr}="${key}"`);
  }

  private setLink(rel: string, hreflang: string | null, href: string): void {
    const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]:not([hreflang])`;
    let link = this.document.head.querySelector<HTMLLinkElement>(selector);
    if (!link) {
      link = this.document.createElement('link');
      link.rel = rel;
      if (hreflang) {
        link.hreflang = hreflang;
      }
      this.document.head.appendChild(link);
    }
    link.href = href;
  }
}
