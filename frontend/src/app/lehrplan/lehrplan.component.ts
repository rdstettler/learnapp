import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { UserService } from '../services/user.service';

interface CurriculumNode {
    id: number;
    code: string;
    fachbereich: string;
    level: string;
    parentCode: string | null;
    zyklus: number | null;
    title: string;
    description: string | null;
    apps?: string[];
    mastery?: number;
    status?: 'started' | 'completed' | 'not_started';
}

interface TreeNode extends CurriculumNode {
    children: TreeNode[];
    expanded: boolean;
}

// Map app IDs to display info
const APP_INFO: Record<string, { name: string; icon: string }> = {
    'dasdass': { name: 'das/dass', icon: '📝' },
    'fehler': { name: 'Fehlerfinden', icon: '🔍' },
    'wortarten': { name: 'Wortarten', icon: '🏷️' },
    'kasus': { name: 'Kasus', icon: '📋' },
    'wortfamilie': { name: 'Wortfamilie', icon: '🌳' },
    'wortstaemme': { name: 'Wortstämme', icon: '🪵' },
    'aehnlichewoerter': { name: 'Ähnliche Wörter', icon: '🔤' },
    'satzzeichen': { name: 'Satzzeichen', icon: '❗' },
    'kopfrechnen': { name: 'Kopfrechnen', icon: '🧮' },
    'textaufgaben': { name: 'Textaufgaben', icon: '📐' },
    'symmetrien': { name: 'Symmetrien', icon: '🔄' },
    'umrechnen': { name: 'Umrechnen', icon: '⚖️' },
    'zeitrechnen': { name: 'Zeitrechnen', icon: '⏰' },
    'verben': { name: 'Verben', icon: '🏃' },
    'synant': { name: 'Synonyme & Antonyme', icon: '🔀' },
    'oberbegriffe': { name: 'Oberbegriffe', icon: '📦' },
    'redewendungen': { name: 'Redewendungen', icon: '💬' },
};

@Component({
    selector: 'app-lehrplan',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './lehrplan.component.html',
    styleUrl: './lehrplan.component.css'
})
export class LehrplanComponent implements OnInit {
    private http = inject(HttpClient);
    private router = inject(Router);
    private userService = inject(UserService);

    loading = signal(true);
    error = signal<string | null>(null);
    activeFachbereich = signal<'deutsch' | 'mathematik'>('deutsch');
    tree = signal<TreeNode[]>([]);

    // Compute the max Zyklus from user's learn_level
    maxZyklus = computed(() => {
        const level = this.userService.profile()?.learnLevel;
        if (!level || level === -1) return 3; // Show all if not set
        if (level <= 4) return 1;  // KG + Primar 1-2 → Zyklus 1
        if (level <= 8) return 2;  // Primar 3-6 → Zyklus 1+2
        return 3;                  // Sek/Gym → all Zyklen
    });

    zyklusLabel = computed(() => {
        const z = this.maxZyklus();
        if (z === 1) return 'Kindergarten – 2. Klasse';
        if (z === 2) return 'bis 6. Klasse';
        return 'Alle Stufen';
    });

    ngOnInit(): void {
        this.loadCurriculum();
    }

    setFachbereich(fb: 'deutsch' | 'mathematik'): void {
        this.activeFachbereich.set(fb);
        this.loadCurriculum();
    }

    async loadCurriculum(): Promise<void> {
        this.loading.set(true);
        this.error.set(null);

        try {
            const z = this.maxZyklus();
            const fb = this.activeFachbereich();
            const response = await firstValueFrom(
                this.http.get<{ nodes: CurriculumNode[] }>(
                    `/api/apps?curriculum=true&fachbereich=${fb}&max_zyklus=${z}`
                )
            );

            this.tree.set(this.buildTree(response.nodes));
        } catch (e: any) {
            console.error('Error loading curriculum:', e);
            this.error.set('Fehler beim Laden des Lehrplans.');
        } finally {
            this.loading.set(false);
        }
    }

    private buildTree(nodes: CurriculumNode[]): TreeNode[] {
        const nodeMap = new Map<string, TreeNode>();

        // Create TreeNode for each node
        for (const node of nodes) {
            nodeMap.set(node.code, {
                ...node,
                children: [],
                expanded: node.level === 'fachbereich' || node.level === 'kompetenzbereich'
            });
        }

        // Build parent-child relationships
        const roots: TreeNode[] = [];
        for (const node of nodeMap.values()) {
            if (node.parentCode && nodeMap.has(node.parentCode)) {
                nodeMap.get(node.parentCode)!.children.push(node);
            } else {
                roots.push(node);
            }
        }

        return roots;
    }

    toggleNode(node: TreeNode): void {
        node.expanded = !node.expanded;
    }

    navigateToApp(appId: string, nodeId?: number): void {
        const queryParams: any = {};
        if (nodeId) {
            queryParams.curriculum_node_id = nodeId;
        }
        this.router.navigate(['/' + appId], { queryParams });
    }

    getAppInfo(appId: string): { name: string; icon: string } {
        return APP_INFO[appId] || { name: appId, icon: '📱' };
    }

    getZyklusLabel(zyklus: number): string {
        return `Zyklus ${zyklus}`;
    }

    getLevelIcon(level: string): string {
        switch (level) {
            case 'kompetenzbereich': return '📚';
            case 'handlungsaspekt': return '🎯';
            case 'kompetenz': return '💡';
            case 'kompetenzstufe': return '📊';
            default: return '📁';
        }
    }

    goBack(): void {
        this.router.navigate(['/']);
    }
}
