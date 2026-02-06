import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { injectSpeedInsights } from '@vercel/speed-insights';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

// Initialize Vercel Speed Insights
injectSpeedInsights();
