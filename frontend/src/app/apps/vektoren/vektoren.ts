import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { ModeSelectorComponent } from '../../shared/components/mode-btn';
import { MathChart, ChartVector } from '../../shared/components/math-chart/math-chart';

type VektorMode = 'zeichnen' | 'ablesen' | 'rechnen' | 'laenge';

@Component({
  selector: 'app-vektoren',
  standalone: true,
  imports: [CommonModule, FormsModule, LearningAppLayoutComponent, ModeSelectorComponent, MathChart],
  templateUrl: './vektoren.html',
  styleUrl: './vektoren.css'
})
export class VektorenComponent {
  readonly modes: { id: VektorMode; label: string; icon: string; description: string }[] = [
    { id: 'zeichnen', label: 'Zeichnen', icon: '✏️', description: 'Zeichne den angegebenen Vektor.' },
    { id: 'ablesen', label: 'Ablesen', icon: '👁️', description: 'Lese die Koordinaten des Vektors ab.' },
    { id: 'rechnen', label: 'Rechnen', icon: '🧮', description: 'Addiere oder skaliere Vektoren.' },
    { id: 'laenge', label: 'Länge', icon: '📏', description: 'Berechne die Länge des Vektors.' }
  ];

  mode = signal<VektorMode>('zeichnen');
  state = signal<'intro' | 'play' | 'feedback'>('intro');

  // Common Score State
  score = signal(0);
  total = signal(0);
  percentage = computed(() => this.total() === 0 ? 0 : Math.round((this.score() / this.total()) * 100));

  // Mode Specific Data
  targetVector = signal<[number, number]>([0,0]);
  targetVector2 = signal<[number, number]>([0,0]);
  scalar = signal<number>(1);
  drawnVector = signal<{start: [number, number], end: [number, number]} | null>(null);
  
  rechnenType = signal<'addition' | 'skalar'>('addition');
  
  // Inputs for 'ablesen', 'laenge'
  inputX = signal<string>('');
  inputY = signal<string>('');
  inputLength = signal<string>('');
  
  feedbackMsg = signal('');
  feedbackCorrect = signal(false);

  // Chart configs
  chartVectors = computed<ChartVector[]>(() => {
    const m = this.mode();
    const s = this.state();
    const vecs: ChartVector[] = [];
    
    // Show target vector if ablesen, addition, skalar, or laenge
    if (m === 'ablesen' || m === 'laenge') {
      vecs.push({ start: [0, 0], end: this.targetVector(), color: '#3b82f6', label: 'v', thickness: 3 });
    } else if (m === 'rechnen') {
      if (this.rechnenType() === 'addition') {
        vecs.push({ start: [0, 0], end: this.targetVector(), color: '#3b82f6', label: 'a', thickness: 3 });
        vecs.push({ start: this.targetVector(), end: [this.targetVector()[0] + this.targetVector2()[0], this.targetVector()[1] + this.targetVector2()[1]], color: '#10b981', label: 'b', thickness: 3 });
        // If we provided feedback, show the correct one
        if (s === 'feedback' && !this.feedbackCorrect()) {
           vecs.push({ start: [0,0], end: [this.targetVector()[0] + this.targetVector2()[0], this.targetVector()[1] + this.targetVector2()[1]], color: '#ef4444', label: 'a+b', thickness: 2 });
        }
      } else {
        vecs.push({ start: [0, 0], end: this.targetVector(), color: '#3b82f6', label: 'v', thickness: 3 });
        if (s === 'feedback' && !this.feedbackCorrect()) {
           vecs.push({ start: [0,0], end: [this.targetVector()[0] * this.scalar(), this.targetVector()[1] * this.scalar()], color: '#ef4444', label: `${this.scalar()}·v`, thickness: 2 });
        }
      }
    } else if (m === 'zeichnen') {
      if (s === 'feedback' && !this.feedbackCorrect()) {
         vecs.push({ start: [0,0], end: this.targetVector(), color: '#ef4444', label: 'Ziel', thickness: 2 });
      }
    }

    // Add drawn vector
    const drawn = this.drawnVector();
    if (drawn) {
      vecs.push({ start: drawn.start, end: drawn.end, color: this.feedbackCorrect() ? '#10b981' : '#f59e0b', thickness: 4 });
    }

    return vecs;
  });

  chartInteractive = computed(() => {
    if (this.state() !== 'play') return 'none';
    const m = this.mode();
    if (m === 'zeichnen' || m === 'rechnen') return 'draw-vector';
    return 'none';
  });

  startQuiz() {
    this.score.set(0);
    this.total.set(0);
    this.nextQuestion();
  }

  randomCoord(min: number, max: number, notZero: boolean = true): number {
    let val;
    do {
      val = Math.floor(Math.random() * (max - min + 1)) + min;
    } while (val === 0 && notZero);
    return val;
  }

  nextQuestion() {
    this.state.set('play');
    this.drawnVector.set(null);
    this.inputX.set('');
    this.inputY.set('');
    this.inputLength.set('');
    this.feedbackMsg.set('');
    
    const m = this.mode();
    if (m === 'zeichnen' || m === 'ablesen') {
      this.targetVector.set([this.randomCoord(-4, 4), this.randomCoord(-4, 4)]);
    } else if (m === 'rechnen') {
      const type = Math.random() > 0.5 ? 'addition' : 'skalar';
      this.rechnenType.set(type);
      if (type === 'addition') {
        this.targetVector.set([this.randomCoord(-3, 3), this.randomCoord(-3, 3)]);
        this.targetVector2.set([this.randomCoord(-3, 3), this.randomCoord(-3, 3)]);
      } else {
        this.targetVector.set([this.randomCoord(-2, 2), this.randomCoord(-2, 2)]);
        const scalars = [-2, -1, 2, 3];
        this.scalar.set(scalars[Math.floor(Math.random() * scalars.length)]);
      }
    } else if (m === 'laenge') {
      // Use Pythagorean triples for neat integer lengths if possible, e.g. 3,4 or 6,8
      const triples = [[3,4], [4,3], [-3,4], [3,-4], [6,8], [-6,8]];
      const pick = triples[Math.floor(Math.random() * triples.length)];
      this.targetVector.set([pick[0], pick[1]]);
    }
  }

  onVectorDrawn(vec: {start: [number, number], end: [number, number]}) {
    this.drawnVector.set(vec);
  }

  checkAnswer() {
    const m = this.mode();
    let isCorrect = false;

    if (m === 'zeichnen') {
      const drawn = this.drawnVector();
      if (!drawn) return;
      const dx = drawn.end[0] - drawn.start[0];
      const dy = drawn.end[1] - drawn.start[1];
      isCorrect = (dx === this.targetVector()[0] && dy === this.targetVector()[1]);
    } else if (m === 'ablesen') {
      const x = parseInt(this.inputX());
      const y = parseInt(this.inputY());
      isCorrect = (x === this.targetVector()[0] && y === this.targetVector()[1]);
    } else if (m === 'rechnen') {
      const drawn = this.drawnVector();
      if (!drawn) return;
      
      let tx: number, ty: number;
      if (this.rechnenType() === 'addition') {
        tx = this.targetVector()[0] + this.targetVector2()[0];
        ty = this.targetVector()[1] + this.targetVector2()[1];
      } else {
        tx = this.targetVector()[0] * this.scalar();
        ty = this.targetVector()[1] * this.scalar();
      }
      
      const dx = drawn.end[0] - drawn.start[0];
      const dy = drawn.end[1] - drawn.start[1];
      isCorrect = (dx === tx && dy === ty);
    } else if (m === 'laenge') {
      const l = parseFloat(this.inputLength().replace(',', '.'));
      const tl = Math.hypot(this.targetVector()[0], this.targetVector()[1]);
      isCorrect = (Math.abs(l - tl) < 0.01);
    }

    this.feedbackCorrect.set(isCorrect);
    if (isCorrect) {
      this.feedbackMsg.set('Richtig! Gut gemacht.');
      this.score.update(s => s + 1);
    } else {
      this.feedbackMsg.set('Leider nicht ganz richtig.');
    }
    this.total.update(t => t + 1);
    this.state.set('feedback');
  }

  restart() {
    this.state.set('intro');
  }
}
