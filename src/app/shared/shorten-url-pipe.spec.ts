import { describe, expect, it } from 'vitest';

import { ShortenUrlPipe } from './shorten-url-pipe';

describe('ShortenUrlPipe', () => {
  const pipe = new ShortenUrlPipe();

  it('returns an empty string for nullish input', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });

  it('strips the http(s) protocol', () => {
    expect(pipe.transform('http://example.com')).toBe('example.com');
    expect(pipe.transform('https://example.com')).toBe('example.com');
  });

  it('truncates long URLs with an ellipsis', () => {
    const result = pipe.transform('https://www.example.com/a/very/long/path/indeed');
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(26);
  });

  it('leaves short URLs untouched', () => {
    expect(pipe.transform('https://oevsv.at')).toBe('oevsv.at');
  });
});
