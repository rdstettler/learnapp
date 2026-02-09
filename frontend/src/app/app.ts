import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastContainerComponent } from './shared/components/toast-container/toast-container.component';
import { BadgeNotificationComponent } from './shared/components/badge-notification/badge-notification.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastContainerComponent, BadgeNotificationComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('learnapp');
}
