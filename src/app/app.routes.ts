import { Routes } from '@angular/router';

import { RepeaterMap } from './repeater/repeater-map';

/** Path of the repeater-list page (kept in one place for links). */
export const LIST_PATH = 'oevsv-repeaterliste';

export const routes: Routes = [
  { path: '', component: RepeaterMap, pathMatch: 'full' },
  {
    path: LIST_PATH,
    loadComponent: () => import('./repeater-list/repeater-list').then((m) => m.RepeaterList),
  },
  { path: '**', redirectTo: '' },
];
