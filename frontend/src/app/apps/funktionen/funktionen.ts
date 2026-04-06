import { Component, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { ModeSelectorComponent } from '../../shared/components/mode-btn';
import { MathChart, ChartPoint, ChartFunction } from '../../shared/components/math-chart/math-chart';

type FunktionMode = 'zeichnen' | 'ablesen';
type FunktionType = 'linear' | 'quadratisch' | 'kubisch' | 'sin' | 'cos' | 'exp' | 'ln';

@Component({
  selector: 'app-funktionen',
  standalone: true,
  imports: [CommonModule, FormsModule, LearningAppLayoutComponent, ModeSelectorComponent, MathChart],
  templateUrl: './funktionen.html',
  styleUrl: './funktionen.css'
})
export class FunktionenComponent {
  readonly modes: { id: FunktionMode; label: string; icon: string; description: string }[] = [
    { id: 'zeichnen', label: 'Funktion Zeichnen', icon: '📈', description: 'Bewege die Punkte, um die angegebene Funktion zu formen.' },
    { id: 'ablesen', label: 'Gleichung Bestimmen', icon: '🔍', description: 'Lese die Funktionsgleichung aus dem Graphen ab.' }
  ];

  mode = signal<FunktionMode>('zeichnen');
  state = signal<'intro' | 'play' | 'feedback'>('intro');
  funktionType = signal<FunktionType>('linear');

  // Common Score State
  score = signal(0);
  total = signal(0);
  percentage = computed(() => this.total() === 0 ? 0 : Math.round((this.score() / this.total()) * 100));

  quadForm = signal<'standard' | 'factored' | 'vertex'>('vertex');

  // Mode Specific Data
  // Linear: y = mx + q
  targetM = signal(1);
  targetQ = signal(0);
  
  // Quadratisch targets
  targetA = signal(1);
  targetB = signal(0);
  targetC = signal(0);
  targetD = signal(0);

  // User input answers for Mode 'ablesen'
  inputM = signal<string>('');
  inputQ = signal<string>('');
  inputA = signal<string>('');
  inputB = signal<string>('');
  inputC = signal<string>('');
  inputD = signal<string>('');

  // Slider answers for Mode 'zeichnen'
  zeichnenModus = signal<'handles' | 'sliders'>('sliders');
  sliderA = signal(1);
  sliderB = signal(0);
  sliderC = signal(0);
  sliderD = signal(0);

  // Interactive points for Mode 'zeichnen'
  // Linear points: [y-intercept, any point]
  // Quadratic points: [vertex, root or some point]
  activePoints = signal<ChartPoint[]>([]);

  feedbackMsg = signal('');
  feedbackCorrect = signal(false);

  // Math Functions to render
  chartFunctions = computed<ChartFunction[]>(() => {
    const fns: ChartFunction[] = [];
    const m = this.mode();
    const type = this.funktionType();
    const form = this.quadForm();
    const zm = this.zeichnenModus();
    
    // Helper to evaluate target function
    const getTargetFn = (x: number) => {
       if (type === 'linear') return this.targetA() * x + this.targetB();
       if (type === 'quadratisch') {
          if (form === 'vertex') return Math.pow(x - this.targetA(), 2) + this.targetB();
          if (form === 'factored') return this.targetA() * (x - this.targetB()) * (x - this.targetC());
          return this.targetA() * x * x + this.targetB() * x + this.targetC();
       }
       if (type === 'kubisch') return this.targetA() * (x - this.targetB()) * (x - this.targetC()) * (x - this.targetD());
       if (type === 'sin') return this.targetA() * Math.sin(this.targetB() * x + this.targetC()) + this.targetD();
       if (type === 'cos') return this.targetA() * Math.cos(this.targetB() * x + this.targetC()) + this.targetD();
       if (type === 'exp') return this.targetA() * Math.exp(this.targetB() * x) + this.targetC();
       if (type === 'ln') return x > 0 ? this.targetA() * Math.log(x) + this.targetB() : NaN;
       return 0;
    };
    
    // In ablesen, just draw the target function
    if (m === 'ablesen') {
        fns.push({ id: 'target', fn: getTargetFn, color: '#3b82f6', thickness: 3 });
    } 
    // In zeichnen, draw the user's function
    else if (m === 'zeichnen') {
      if (zm === 'sliders') {
         // Sliders mode: Track signals outside the callback for reactivity
         const a = this.sliderA();
         const b = this.sliderB();
         const c = this.sliderC();
         const d = this.sliderD();
         
         // In slider mode, we always show the target curve so the user can match it visually
         fns.push({ id: 'target', fn: getTargetFn, color: '#3b82f6', thickness: 3 });

         fns.push({ id: 'user', fn: (x) => {
            if (type === 'linear') return a * x + b;
            if (type === 'quadratisch') {
               if (form === 'vertex') return Math.pow(x - a, 2) + b;
               if (form === 'factored') return a * (x - b) * (x - c);
               return a * x * x + b * x + c;
            }
            if (type === 'kubisch') return a * (x - b) * (x - c) * (x - d);
            if (type === 'sin') return a * Math.sin(b * x + c) + d;
            if (type === 'cos') return a * Math.cos(b * x + c) + d;
            if (type === 'exp') return a * Math.exp(b * x) + c;
            if (type === 'ln') return x > 0 ? a * Math.log(x) + b : NaN;
            return 0;
         }, color: '#f59e0b', thickness: 4 });
      } else {
         // Handles mode
         const pts = this.activePoints();
         if (type === 'linear' && pts.length >= 2) {
           const p1 = pts[0], p2 = pts[1];
           if (p2.x !== p1.x) {
             const slope = (p2.y - p1.y) / (p2.x - p1.x);
             const intercept = p1.y - slope * p1.x;
             fns.push({ id: 'user', fn: (x) => slope * x + intercept, color: '#f59e0b', thickness: 4 });
           }
         } else if (type === 'quadratisch' && pts.length >= 3) {
           const [p1, p2, p3] = pts;
           const denom = (p1.x - p2.x) * (p1.x - p3.x) * (p2.x - p3.x);
           if (Math.abs(denom) > 0.0001) {
             const a = (p3.x * (p1.y - p2.y) + p2.x * (p3.y - p1.y) + p1.x * (p2.y - p3.y)) / denom;
             const b = (p3.x * p3.x * (p2.y - p1.y) + p2.x * p2.x * (p1.y - p3.y) + p1.x * p1.x * (p3.y - p2.y)) / denom;
             const c = (p2.x * p3.x * (p2.x - p3.x) * p1.y + p3.x * p1.x * (p3.x - p1.x) * p2.y + p1.x * p2.x * (p1.x - p2.x) * p3.y) / denom;
             fns.push({ id: 'user', fn: (x) => a * x * x + b * x + c, color: '#f59e0b', thickness: 4 });
           }
         }
      }

      // Show correct answer curve in red if failed
      if (this.state() === 'feedback' && !this.feedbackCorrect()) {
         fns.push({ id: 'correct', fn: getTargetFn, color: '#ef4444', thickness: 2 });
      }
    }
    return fns;
  });

  chartInteractive = computed(() => {
    if (this.state() !== 'play') return 'none';
    if (this.mode() === 'zeichnen' && this.zeichnenModus() === 'handles') return 'drag-points';
    return 'none';
  });

  startQuiz(type: FunktionType) {
    this.funktionType.set(type);
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
    this.feedbackMsg.set('');
    
    // Clear text inputs
    this.inputA.set('');
    this.inputB.set('');
    this.inputC.set('');
    this.inputD.set('');
    
    // Reset sliders
    this.sliderA.set(1);
    this.sliderB.set(0);
    this.sliderC.set(0);
    this.sliderD.set(0);
    
    const type = this.funktionType();
    
    if (type === 'linear') {
      this.targetA.set(this.randomCoord(-3, 3)); // slope
      this.targetB.set(this.randomCoord(-4, 4, false)); // intercept
      
      this.activePoints.set([
        { id: 'p1', x: 0, y: 0, color: '#10b981', draggable: true },
        { id: 'p2', x: 2, y: 2, color: '#10b981', draggable: true }
      ]);
    } else if (type === 'quadratisch') {
      const forms: ('standard' | 'factored' | 'vertex')[] = ['standard', 'factored', 'vertex'];
      const form = forms[Math.floor(Math.random() * forms.length)];
      this.quadForm.set(form);

      if (form === 'vertex') {
         // y = (x - a)^2 + b
         // Note: user explicitly omitted leading stretch multiplier, so a=1
         this.targetA.set(this.randomCoord(-3, 3, false)); // corresponds to 'a' in prompt (vertex x)
         this.targetB.set(this.randomCoord(-4, 4, false)); // corresponds to 'b' in prompt (vertex y)
         this.targetC.set(0); // unused
      } else if (form === 'factored') {
         // a(x-b)(x-c)
         const aVals = [1, -1, 0.5, -0.5, 2, -2];
         this.targetA.set(aVals[Math.floor(Math.random() * aVals.length)]);
         this.targetB.set(this.randomCoord(-4, 4, false)); // root 1
         this.targetC.set(this.randomCoord(-4, 4, false)); // root 2
      } else {
         // standard: ax^2 + bx + c
         const aVals = [1, -1, 0.5, -0.5, 2, -2];
         this.targetA.set(aVals[Math.floor(Math.random() * aVals.length)]);
         this.targetB.set(this.randomCoord(-3, 3, false)); // b
         this.targetC.set(this.randomCoord(-4, 4, false)); // c
      }
      
      // 3 Points for quadratics naturally spreading
      this.activePoints.set([
        { id: 'p1', x: -2, y: 4, color: '#10b981', draggable: true },
        { id: 'p2', x: 0, y: 0, color: '#10b981', draggable: true },
        { id: 'p3', x: 2, y: 4, color: '#10b981', draggable: true }
      ]);
    } else if (type === 'kubisch') {
       this.targetA.set(Math.random() > 0.5 ? 0.25 : -0.25);
       this.targetB.set(this.randomCoord(-3, 3, false));
       this.targetC.set(this.randomCoord(-3, 3, false));
       this.targetD.set(this.randomCoord(-3, 3, false));
       this.activePoints.set([]); // handles not supported by default, rely on sliders
    } else if (type === 'sin' || type === 'cos') {
       this.targetA.set(this.randomCoord(1, 3, false));  // Amplitude
       this.targetB.set(this.randomCoord(1, 3, false) * (Math.random() > 0.5 ? 1 : 0.5));  // Freq
       this.targetC.set(this.randomCoord(-2, 2, false)); // Phase
       this.targetD.set(this.randomCoord(-2, 2, false)); // Y-Offset
       this.activePoints.set([]);
    } else if (type === 'exp') {
       this.targetA.set(Math.random() > 0.5 ? 1 : -1); 
       this.targetB.set(Math.random() > 0.5 ? 1 : 0.5); 
       this.targetC.set(this.randomCoord(-3, 3, false)); 
       this.activePoints.set([]);
    } else if (type === 'ln') {
       this.targetA.set(Math.random() > 0.5 ? 1 : -1); 
       this.targetB.set(this.randomCoord(-3, 3, false)); 
       this.activePoints.set([]);
    }
  }

  onPointDragged(ev: {id: string, x: number, y: number}) {
    // Restrict p1 horizontal movement for linear (y-intercept)
    let newX = ev.x;
    if (this.funktionType() === 'linear' && ev.id === 'p1') {
      newX = 0;
    }
    
    // Prevent p2 from having same x as p1
    if (ev.id === 'p2') {
      const p1 = this.activePoints().find(p => p.id === 'p1');
      if (p1 && newX === p1.x) {
         newX = p1.x + 1; // force minimal shift
      }
    }
    
    this.activePoints.update(pts => pts.map(p => p.id === ev.id ? { ...p, x: newX, y: ev.y } : p));
  }

  checkAnswer() {
    let isCorrect = false;
    const type = this.funktionType();
    const form = this.quadForm();
    const m = this.mode();
    const zm = this.zeichnenModus();

    if (m === 'zeichnen') {
      if (zm === 'sliders') {
         isCorrect = Math.abs(this.sliderA() - this.targetA()) < 0.01 && 
                     Math.abs(this.sliderB() - this.targetB()) < 0.01 && 
                     Math.abs(this.sliderC() - this.targetC()) < 0.01 && 
                     Math.abs(this.sliderD() - this.targetD()) < 0.01;
      } else {
        const pts = this.activePoints();
        if (type === 'linear' && pts.length >= 2) {
          const p1 = pts[0], p2 = pts[1];
          if (p2.x !== p1.x) {
            const slope = (p2.y - p1.y) / (p2.x - p1.x);
            const intercept = p1.y - slope * p1.x;
            isCorrect = Math.abs(slope - this.targetA()) < 0.01 && Math.abs(intercept - this.targetB()) < 0.01;
          }
        } else if (type === 'quadratisch' && pts.length >= 3) {
          const [p1, p2, p3] = pts;
          const denom = (p1.x - p2.x) * (p1.x - p3.x) * (p2.x - p3.x);
          if (Math.abs(denom) > 0.0001) {
             const drawnA = (p3.x * (p1.y - p2.y) + p2.x * (p3.y - p1.y) + p1.x * (p2.y - p3.y)) / denom;
             const drawnB = (p3.x * p3.x * (p2.y - p1.y) + p2.x * p2.x * (p1.y - p3.y) + p1.x * p1.x * (p3.y - p2.y)) / denom;
             const drawnC = (p2.x * p3.x * (p2.x - p3.x) * p1.y + p3.x * p1.x * (p3.x - p1.x) * p2.y + p1.x * p2.x * (p1.x - p2.x) * p3.y) / denom;
             
             // Extract target generic polynomial form A, B, C bounds
             let ta = this.targetA(), tb = this.targetB(), tc = this.targetC();
             if (form === 'vertex') {
                 tb = -2 * ta; // expanded -2a
                 tc = Math.pow(ta, 2) + this.targetB(); // expanded a^2+b
                 ta = 1; // Since a=1 was assumed
             } else if (form === 'factored') {
                 tb = -ta * (this.targetB() + this.targetC());
                 tc = ta * this.targetB() * this.targetC();
             }
             isCorrect = Math.abs(drawnA - ta) < 0.01 && Math.abs(drawnB - tb) < 0.01 && Math.abs(drawnC - tc) < 0.01;
          }
        }
      }
    } else if (m === 'ablesen') {
      const ua = parseFloat(this.inputA().replace(',', '.') || '0');
      const ub = parseFloat(this.inputB().replace(',', '.') || '0');
      const uc = parseFloat(this.inputC().replace(',', '.') || '0');
      const ud = parseFloat(this.inputD().replace(',', '.') || '0');

      if (type === 'linear') {
        const um = parseFloat(this.inputM().replace(',', '.') || '0');
        const uq = parseFloat(this.inputQ().replace(',', '.') || '0');
        isCorrect = Math.abs(um - this.targetA()) < 0.01 && Math.abs(uq - this.targetB()) < 0.01;
      } else if (type === 'quadratisch') {
        if (form === 'vertex') {
          isCorrect = Math.abs(ua - this.targetA()) < 0.01 && Math.abs(ub - this.targetB()) < 0.01;
        } else if (form === 'factored') {
          const rootMatch = (Math.abs(ub - this.targetB()) < 0.01 && Math.abs(uc - this.targetC()) < 0.01) ||
                            (Math.abs(ub - this.targetC()) < 0.01 && Math.abs(uc - this.targetB()) < 0.01);
          isCorrect = Math.abs(ua - this.targetA()) < 0.01 && rootMatch;
        } else {
          isCorrect = Math.abs(ua - this.targetA()) < 0.01 && Math.abs(ub - this.targetB()) < 0.01 && Math.abs(uc - this.targetC()) < 0.01;
        }
      } else if (type === 'kubisch' || type === 'sin' || type === 'cos') {
          isCorrect = Math.abs(ua - this.targetA()) < 0.01 && Math.abs(ub - this.targetB()) < 0.01 && Math.abs(uc - this.targetC()) < 0.01 && Math.abs(ud - this.targetD()) < 0.01;
      } else if (type === 'exp') {
          isCorrect = Math.abs(ua - this.targetA()) < 0.01 && Math.abs(ub - this.targetB()) < 0.01 && Math.abs(uc - this.targetC()) < 0.01;
      } else if (type === 'ln') {
          isCorrect = Math.abs(ua - this.targetA()) < 0.01 && Math.abs(ub - this.targetB()) < 0.01;
      }
    }

    this.feedbackCorrect.set(isCorrect);
    if (isCorrect) {
      this.feedbackMsg.set('Richtig! Gut gemacht.');
      this.score.update(s => s + 1);
    } else {
      if (m === 'ablesen') {
        let correctStr = '';
        if (type === 'linear') { correctStr = `f(x) = ${this.targetA()}x + ${this.targetB()}`; }
        else if (type === 'quadratisch') {
            if (form === 'vertex') { correctStr = `f(x) = (x - ${this.targetA()})² + ${this.targetB()}`; }
            else if (form === 'factored') { correctStr = `f(x) = ${this.targetA()}(x - ${this.targetB()})(x - ${this.targetC()})`; }
            else { correctStr = `f(x) = ${this.targetA()}x² + ${this.targetB()}x + ${this.targetC()}`; }
        } else if (type === 'kubisch') { correctStr = `f(x) = ${this.targetA()}(x - ${this.targetB()})(x - ${this.targetC()})(x - ${this.targetD()})`; }
        else if (type === 'sin') { correctStr = `f(x) = ${this.targetA()} * sin(${this.targetB()}x + ${this.targetC()}) + ${this.targetD()}`; }
        else if (type === 'cos') { correctStr = `f(x) = ${this.targetA()} * cos(${this.targetB()}x + ${this.targetC()}) + ${this.targetD()}`; }
        else if (type === 'exp') { correctStr = `f(x) = ${this.targetA()} * e^(${this.targetB()}x) + ${this.targetC()}`; }
        else if (type === 'ln') { correctStr = `f(x) = ${this.targetA()} * ln(x) + ${this.targetB()}`; }

        this.feedbackMsg.set(`Leider falsch. Richtig wäre:\n${correctStr}`);
      } else {
        this.feedbackMsg.set('Leider nicht ganz richtig.');
      }
    }
    this.total.update(t => t + 1);
    this.state.set('feedback');
  }

  restart() {
    this.state.set('intro');
  }

  abs(val: number): number {
    return Math.abs(val);
  }
}
