import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-about',
    standalone: true,
    templateUrl: './about.component.html',
    styles: [`
    .about-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      color: var(--text-primary);
    }
    .about-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .back-btn {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 1.1rem;
      padding: 0.5rem;
      border-radius: 8px;
    }
    .back-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: var(--text-primary);
    }
    .section {
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    h1 {
      font-size: 2rem;
      margin: 0;
    }
    h2 {
      font-size: 1.2rem;
      margin-top: 0;
      margin-bottom: 1rem;
      color: var(--accent-primary);
    }
    p {
      line-height: 1.6;
      color: var(--text-secondary);
      margin-bottom: 0;
    }
    .highlight {
      color: var(--text-primary);
      font-weight: 500;
    }
  `]
})
export class AboutComponent {
    private router = inject(Router);

    goBack(): void {
        this.router.navigate(['/']);
    }
}
