import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { FrqmapComponent } from './map/frqmap.component';
import { ListComponent } from './list/list.component';
import { StatusListComponent } from './list/status-list.component';

const routes: Routes = [
  // Map, filtered by repeater type: /all/map, /fm/map, /dmr/map, ... The type is
  // checked against the types in the backend settings (unknown -> /all/map).
  { path: ':type/map', component: FrqmapComponent },
  // A site on the map (all types), selected and zoomed in: /site/OE3XNR.
  { path: 'site/:callsign', component: FrqmapComponent },
  // Repeater list (port of oevsv-repeaterliste).
  { path: 'list', component: ListComponent },
  // Status of the repeaters in the networks of one technology: /list/fm, /list/dmr, ...
  { path: 'list/:technology', component: StatusListComponent },
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
