import { Routes } from '@angular/router';

export const routes: Routes = [
    { path: '', loadComponent: () => import('./platform/platform.component').then(m => m.PlatformComponent) },
    { path: 'aehnlichewoerter', loadComponent: () => import('./apps/aehnlichewoerter/aehnlichewoerter.component').then(m => m.AehnlichewoerterComponent) },
    { path: 'kopfrechnen', loadComponent: () => import('./apps/kopfrechnen/kopfrechnen.component').then(m => m.KopfrechnenComponent) },
    { path: 'symmetry', loadComponent: () => import('./apps/symmetry/symmetry.component').then(m => m.SymmetryComponent) },
    { path: 'wortstaemme', loadComponent: () => import('./apps/wortstaemme/wortstaemme.component').then(m => m.WortstaemmeComponent) },
    { path: 'verben', loadComponent: () => import('./apps/verben/verben.component').then(m => m.VerbenComponent) },
    { path: 'kasus', loadComponent: () => import('./apps/kasus/kasus.component').then(m => m.KasusComponent) },
    { path: 'redewendungen', loadComponent: () => import('./apps/redewendungen/redewendungen.component').then(m => m.RedewendungenComponent) },
    { path: 'satzzeichen', loadComponent: () => import('./apps/satzzeichen/satzzeichen.component').then(m => m.SatzzeichenComponent) },
    { path: 'fehler', loadComponent: () => import('./apps/fehler/fehler.component').then(m => m.FehlerComponent) },
    { path: 'dasdass', loadComponent: () => import('./apps/dasdass/dasdass.component').then(m => m.DasdassComponent) },
    { path: 'textaufgaben', loadComponent: () => import('./apps/textaufgaben/textaufgaben.component').then(m => m.TextaufgabenComponent) },
    { path: 'symmetrien', loadComponent: () => import('./apps/symmetrien/symmetrien.component').then(m => m.SymmetrienComponent) },
    { path: 'isolation', loadComponent: () => import('./apps/isolation/isolation.component').then(m => m.IsolationComponent) },
    { path: 'quarto', loadComponent: () => import('./apps/quarto/quarto.component').then(m => m.QuartoComponent) },
    { path: '**', redirectTo: '' }
];
