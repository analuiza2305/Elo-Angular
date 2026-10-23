import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

import { provideRouter } from '@angular/router';



import { routes } from './app.routes';

import { provideClientHydration, withEventReplay } from '@angular/platform-browser';



// OBS: o Firebase (Auth + Firestore) deste projeto é inicializado uma

// única vez em `src/app/core/firebase.ts`, usando o SDK modular puro

// (o mesmo padrão já usado em home-adv.ts). Não usamos @angular/fire

// aqui para não corrermos o risco de inicializar o app do Firebase

// duas vezes ("Firebase App named '[DEFAULT]' already exists").



export const appConfig: ApplicationConfig = {

  providers: [

    provideBrowserGlobalErrorListeners(),

    provideRouter(routes),

    provideClientHydration(withEventReplay()),

  ],

};

