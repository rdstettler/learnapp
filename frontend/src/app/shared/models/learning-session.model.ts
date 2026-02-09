export interface TheoryCard {
    title: string;
    content: string;
}

export interface SessionTask {
    id: number;
    app_id: string;
    pristine: boolean | number;
    content: Record<string, unknown>;
}

export interface LearningSession {
    session_id: string;
    topic: string;
    text: string;
    theory: TheoryCard[];
    created_at?: string;
    tasks: SessionTask[];
}

export interface SuggestedApp {
    id: string;
    name: string;
    description: string;
    tags: string[];
    featured: boolean;
}

export interface NotEnoughDataResponse {
    message: string;
    suggestedApps: SuggestedApp[];
}

// ═══════════════════════════════════════
//  Learning Plan models
// ═══════════════════════════════════════

export interface PlanTask {
    id: number;
    day_number: number;
    order_index: number;
    app_id: string;
    app_content_id: number;
    completed: boolean;
    completed_at: string | null;
    content: Record<string, unknown>;
    app_name: string;
    app_icon: string;
    app_route: string;
}

export interface PlanDay {
    day: number;
    focus?: string;
    tasks: PlanTask[];
}

export interface LearningPlan {
    plan_id: string;
    title: string;
    description: string;
    status: 'active' | 'completed' | 'abandoned';
    total_days: number;
    created_at: string;
    plan_data: { day: number; focus: string }[];
    days: PlanDay[];
}

export interface PlanNotEnoughDataResponse {
    message: string;
    hint: string;
}
