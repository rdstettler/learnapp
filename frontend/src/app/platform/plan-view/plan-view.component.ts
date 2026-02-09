import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { LearningPlan, PlanDay, PlanTask, PlanNotEnoughDataResponse } from '../../shared/models/learning-session.model';

@Component({
    selector: 'app-plan-view',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './plan-view.component.html',
    styleUrl: './plan-view.component.css'
})
export class PlanViewComponent implements OnInit {
    private apiService = inject(ApiService);
    private router = inject(Router);

    loading = signal(true);
    generating = signal(false);
    generationError = signal<string | null>(null);
    notEnoughData = signal<string | null>(null);

    plan = signal<LearningPlan | null>(null);

    // Day selector
    selectedDay = signal<number>(1);

    // Days config for the plan generation
    daysConfig = signal(3);

    // Generation timer
    generationSeconds = signal(0);
    loadingMessage = computed(() => {
        const sec = this.generationSeconds();
        if (sec < 5) return "Analysiere deine Stärken und Schwächen...";
        if (sec < 10) return "Suche passende Übungen...";
        if (sec < 20) return "Erstelle deinen persönlichen Lernplan...";
        if (sec < 30) return "Organisiere die Aufgaben nach Tagen...";
        if (sec < 40) return "Füge motivierende Beschreibungen hinzu...";
        return "Fast fertig...";
    });

    // Computed: total progress
    totalTasks = computed(() => {
        const p = this.plan();
        if (!p) return 0;
        return p.days.reduce((sum, d) => sum + d.tasks.length, 0);
    });

    completedTasks = computed(() => {
        const p = this.plan();
        if (!p) return 0;
        return p.days.reduce((sum, d) => sum + d.tasks.filter(t => t.completed).length, 0);
    });

    overallProgress = computed(() => {
        const total = this.totalTasks();
        return total > 0 ? Math.round((this.completedTasks() / total) * 100) : 0;
    });

    // Current day's tasks
    currentDayTasks = computed(() => {
        const p = this.plan();
        const day = this.selectedDay();
        if (!p) return [];
        const d = p.days.find(d => d.day === day);
        return d ? d.tasks : [];
    });

    currentDayFocus = computed(() => {
        const p = this.plan();
        const day = this.selectedDay();
        if (!p || !p.plan_data) return '';
        const dayData = (p.plan_data as { day: number; focus: string }[]).find(d => d.day === day);
        return dayData?.focus || '';
    });

    currentDayProgress = computed(() => {
        const tasks = this.currentDayTasks();
        if (tasks.length === 0) return 0;
        return Math.round((tasks.filter(t => t.completed).length / tasks.length) * 100);
    });

    // Group tasks by app for cleaner display
    groupedCurrentDayTasks = computed(() => {
        const tasks = this.currentDayTasks();
        const groups: { app_id: string; app_name: string; app_icon: string; app_route: string; tasks: PlanTask[] }[] = [];

        for (const task of tasks) {
            const existing = groups.find(g => g.app_id === task.app_id);
            if (existing) {
                existing.tasks.push(task);
            } else {
                groups.push({
                    app_id: task.app_id,
                    app_name: task.app_name,
                    app_icon: task.app_icon,
                    app_route: task.app_route,
                    tasks: [task]
                });
            }
        }
        return groups;
    });

    ngOnInit(): void {
        this.loadPlan();
    }

    async loadPlan(): Promise<void> {
        this.loading.set(true);
        this.notEnoughData.set(null);

        try {
            const result = await this.apiService.getLearningPlan();
            if (result && 'plan_id' in result) {
                this.plan.set(result as LearningPlan);
                // Auto-select the first incomplete day
                this.autoSelectDay(result as LearningPlan);
            } else if (result && 'message' in result) {
                this.notEnoughData.set((result as PlanNotEnoughDataResponse).hint);
            } else {
                this.plan.set(null);
            }
        } catch (e) {
            console.error('Error loading plan:', e);
        } finally {
            this.loading.set(false);
        }
    }

    private autoSelectDay(plan: LearningPlan): void {
        // Find first day with incomplete tasks
        for (const day of plan.days) {
            if (day.tasks.some(t => !t.completed)) {
                this.selectedDay.set(day.day);
                return;
            }
        }
        // All done — select last day
        if (plan.days.length > 0) {
            this.selectedDay.set(plan.days[plan.days.length - 1].day);
        }
    }

    selectDay(day: number): void {
        this.selectedDay.set(day);
    }

    isDayComplete(dayNum: number): boolean {
        const p = this.plan();
        if (!p) return false;
        const day = p.days.find(d => d.day === dayNum);
        return day ? day.tasks.every(t => t.completed) : false;
    }

    getDayCompletedCount(dayNum: number): number {
        const p = this.plan();
        if (!p) return 0;
        const day = p.days.find(d => d.day === dayNum);
        return day ? day.tasks.filter(t => t.completed).length : 0;
    }

    getDayTotalCount(dayNum: number): number {
        const p = this.plan();
        if (!p) return 0;
        const day = p.days.find(d => d.day === dayNum);
        return day ? day.tasks.length : 0;
    }

    async startTask(group: { app_id: string; app_route: string; tasks: PlanTask[] }): Promise<void> {
        // Find the first incomplete task in the group
        const incompleteTasks = group.tasks.filter(t => !t.completed);
        if (incompleteTasks.length === 0) return;

        // Merge content from all incomplete tasks for this app
        let mergedContent: Record<string, unknown> | Record<string, unknown>[] = {};
        const taskIds = incompleteTasks.map(t => t.id);

        if (group.app_id === 'dasdass' || group.app_id === 'kasus') {
            const allSentences: string[] = [];
            for (const t of incompleteTasks) {
                const c = t.content;
                if (c?.['sentences'] && Array.isArray(c['sentences'])) {
                    allSentences.push(...(c['sentences'] as string[]));
                }
            }
            mergedContent = { sentences: allSentences };
        } else if (group.app_id === 'textaufgaben') {
            mergedContent = incompleteTasks.map(t => t.content);
        } else {
            mergedContent = incompleteTasks[0].content;
        }

        this.router.navigate([group.app_route], {
            state: {
                learningContent: mergedContent,
                planTaskIds: taskIds,
                fromPlan: true
            }
        });
    }

    async markGroupComplete(group: { tasks: PlanTask[] }): Promise<void> {
        const incompleteIds = group.tasks.filter(t => !t.completed).map(t => t.id);
        if (incompleteIds.length === 0) return;

        // Optimistic update
        this.plan.update(p => {
            if (!p) return null;
            return {
                ...p,
                days: p.days.map(d => ({
                    ...d,
                    tasks: d.tasks.map(t =>
                        incompleteIds.includes(t.id)
                            ? { ...t, completed: true, completed_at: new Date().toISOString() }
                            : t
                    )
                }))
            };
        });

        const success = await this.apiService.completePlanTask(incompleteIds);
        if (!success) {
            await this.loadPlan(); // Revert
        }
    }

    async generatePlan(): Promise<void> {
        this.generating.set(true);
        this.generationError.set(null);
        this.generationSeconds.set(0);

        const interval = setInterval(() => {
            this.generationSeconds.update(s => s + 1);
        }, 1000);

        try {
            const plan = await this.apiService.generateLearningPlan(this.daysConfig());
            this.plan.set(plan);
            this.autoSelectDay(plan);
        } catch (e: unknown) {
            console.error('Error generating plan:', e);
            const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
            if (e instanceof Object && 'error' in e) {
                this.generationError.set((e as { error: { error: string } }).error?.error || msg);
            } else {
                this.generationError.set(msg);
            }
        } finally {
            clearInterval(interval);
            this.generating.set(false);
        }
    }

    async abandonPlan(): Promise<void> {
        if (!confirm('Möchtest du deinen aktuellen Lernplan wirklich aufgeben?')) return;

        await this.apiService.abandonPlan();
        this.plan.set(null);
    }

    setDaysConfig(days: number): void {
        this.daysConfig.set(Math.min(Math.max(days, 1), 7));
    }

    isGroupComplete(group: { tasks: PlanTask[] }): boolean {
        return group.tasks.length > 0 && group.tasks.every(t => t.completed);
    }

    getGroupCompletedCount(group: { tasks: PlanTask[] }): number {
        return group.tasks.filter(t => t.completed).length;
    }

    hasIncompleteTasks(group: { tasks: PlanTask[] }): boolean {
        return group.tasks.some(t => !t.completed);
    }
}
