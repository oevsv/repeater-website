import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { FrqmapComponent } from './map/frqmap.component';
import { ListComponent } from './list/list.component';

const routes: Routes = [
  // Map, filtered by repeater type: /all/map, /fm/map, /dmr/map, ... The type is
  // checked against the types in the backend settings (unknown -> /all/map).
  // Room for more pages per type later, e.g. /fm/list.
  { path: ':type/map', component: FrqmapComponent },
  // Repeater list (port of oevsv-repeaterliste).
  { path: 'list', component: ListComponent },
  // Start page and old links: the map with all repeater types.
  { path: '', redirectTo: 'all/map', pathMatch: 'full' },
  { path: 'index.html', redirectTo: 'all/map', pathMatch: 'full' },
  { path: '**', redirectTo: 'all/map' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
