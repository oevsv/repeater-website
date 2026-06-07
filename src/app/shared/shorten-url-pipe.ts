import { Pipe, PipeTransform } from '@angular/core';

/**
 * Strips the protocol from a URL and truncates it for compact display.
 *
 * `https://www.example.com/very/long/path` → `www.example.com/very/long…`
 */
@Pipe({ name: 'shortenUrl' })
export class ShortenUrlPipe implements PipeTransform {
  private static readonly MAX_LENGTH = 30;

  transform(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const withoutProtocol = value.replace(/^https?:\/\//, '');

    return withoutProtocol.length > ShortenUrlPipe.MAX_LENGTH
      ? `${withoutProtocol.slice(0, 25)}…`
      : withoutProtocol;
  }
}
