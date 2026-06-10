import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { FrqmapComponent } from './map/frqmap.component';
import { ListComponent } from './list/list.component';

const routes: Routes = [
  // Home / map: available at "/" and "/index.html".
  { path: '', component: FrqmapComponent, pathMatch: 'full' },
  { path: 'index.html', redirectTo: '', pathMatch: 'full' },
  // Repeater list (port of oevsv-repeaterliste).
  { path: 'list', component: ListComponent },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
