import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { provideHttpClient, withXhr } from '@angular/common/http';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ShortenUrl } from './shorten-url.pipe';
import { FrqmapComponent } from './map/frqmap.component';
import { ListComponent } from './list/list.component';

@NgModule({
  declarations: [AppComponent, FrqmapComponent, ListComponent, ShortenUrl],
  imports: [BrowserModule, AppRoutingModule, FormsModule],
  // Angular 22 bootstraps zoneless by default; this app mutates state inside
  // RxJS subscribe callbacks, so it needs zone-based change detection to refresh
  // template bindings (zone.js is loaded via polyfills.ts).
  providers: [provideZoneChangeDetection(), provideHttpClient(withXhr())],
  bootstrap: [AppComponent],
})
export class AppModule {}
