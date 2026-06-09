import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  standalone: false,
  name: 'shortenUrl',
})
export class ShortenUrl implements PipeTransform {
  transform(value: String): String {
    // remove protocol prefix
    if (value.substr(0, 7) == 'http://') {
      value = value.substr(7);
    }
    if (value.substr(0, 8) == 'https://') {
      value = value.substr(8);
    }
    // cut off url if too long
    if (value.length > 30) {
      value = value.substr(0, 25) + '…';
    }
    return value;
  }
}
