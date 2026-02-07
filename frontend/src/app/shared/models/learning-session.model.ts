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
