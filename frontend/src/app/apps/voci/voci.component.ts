import { Component, signal, computed, inject, OnInit, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { DataService } from '../../services/data.service';
import { LearningAppLayoutComponent } from '../../shared/components/learning-app-layout/learning-app-layout.component';
import { launchConfetti } from '../../shared/confetti';
import { ModeSelectorComponent } from '../../shared/components/mode-btn';

export interface AiTask {
    id: number;
    text: string;
    hint?: string;
}

export interface AiFeedback {
    id: number;
    pass: 1 | 0 | -1;
    hint?: string;
    correction?: string;
}

interface IterationItem {
    id: number;
    text: string;
    user: string;
}

const LANG_CONFIG: Record<string, { name: string; flag: string; label: string }> = {
    fr: { name: 'Französisch', flag: '🇫🇷', label: 'FR' },
    en: { name: 'Englisch', flag: '🇬🇧', label: 'EN' },
    it: { name: 'Italienisch', flag: '🇮🇹', label: 'IT' },
    es: { name: 'Spanisch', flag: '🇪🇸', label: 'ES' },
};

@Component({
    selector: 'app-voci',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        LearningAppLayoutComponent,
        ModeSelectorComponent,
    ],
    templateUrl: './voci.component.html',
    styleUrl: './voci.component.css'
})
export class VociComponent implements OnInit, OnDestroy {
    private dataService = inject(DataService);
    private route = inject(ActivatedRoute);

    langCode = signal<string>('en');
    langConfig = computed(() => LANG_CONFIG[this.langCode()] ?? { name: this.langCode().toUpperCase(), flag: '🌍', label: this.langCode().toUpperCase() });
    pageTitle = computed(() => `Sprachen Lernen`);
    availableLanguages = Object.entries(LANG_CONFIG).map(([code, config]) => ({ code, ...config }));

    // Settings
    readonly taskModes: { id: 'translation' | 'reply'; label: string; icon: string; description: string }[] = [
        { id: 'translation', label: 'Übersetzen', icon: '📝', description: 'Übersetze die vorgegebenen Sätze.' },
        { id: 'reply', label: 'Antworten', icon: '🗣️', description: 'Führe ein Gespräch und antworte frei.' }
    ];
    taskMode = signal<'translation' | 'reply'>('translation');

    readonly inputModes: { id: 'text' | 'speech'; label: string; icon: string; description: string }[] = [
        { id: 'text', label: 'Tippen', icon: '⌨️', description: 'Tippe deine Antwort ein.' },
        { id: 'speech', label: 'Sprechen', icon: '🎤', description: 'Sprich deine Antwort ein.' }
    ];
    inputMode = signal<'text' | 'speech'>('text');

    readonly outputModes: { id: 'text' | 'speech'; label: string; icon: string; description: string }[] = [
        { id: 'text', label: 'Lesen', icon: '📖', description: 'Lese die Aufgaben auf dem Bildschirm.' },
        { id: 'speech', label: 'Zuhören', icon: '🎧', description: 'Die Aufgaben werden dir vorgelesen.' }
    ];
    outputMode = signal<'text' | 'speech'>('text');

    // State
    screen = signal<'welcome' | 'loading' | 'quiz' | 'feedback' | 'finished'>('welcome');
    
    // AI Loop Data
    currentBatch = signal<AiTask[]>([]);
    userAnswers = signal<Record<number, string>>({});
    previousIteration = signal<IterationItem[]>([]);
    lastSessionData = signal<IterationItem[]>([]);
    feedbackBatch = signal<AiFeedback[]>([]);
    audioCache = signal<Record<number, string>>({});
    
    detailedFeedback = computed(() => {
        const feedback = this.feedbackBatch();
        const lastData = this.lastSessionData();
        
        return feedback.map(fb => {
            const original = lastData.find(d => d.id === fb.id);
            return {
                ...fb,
                originalText: original?.text,
                userText: original?.user
            };
        });
    });
    
    // Quiz State
    isRecording = signal<number | null>(null); // holds task.id being recorded
    isAudioProcessing = signal<number | null>(null);
    answered = signal(false);
    
    // Audio stuff
    private mediaRecorder: any = null;
    private currentAudio: HTMLAudioElement | null = null;

    ngOnInit(): void {
        const paramLang = this.route.snapshot.paramMap.get('langCode');
        if (paramLang) {
            this.langCode.set(paramLang);
        }
    }

    ngOnDestroy(): void {
        this.stopAnyAudio();
        if (this.isRecording() !== null) {
            this.stopRecording();
        }
    }

    startSession(): void {
        this.previousIteration.set([]);
        this.fetchNextBatch();
    }

    private fetchNextBatch(): void {
        this.screen.set('loading');
        this.stopAnyAudio();

        const iterationPayload = this.previousIteration();

        this.dataService.generateAiVoci(this.langCode(), this.taskMode(), this.inputMode(), iterationPayload).subscribe({
            next: (res) => {
                if (res.feedback) {
                    this.feedbackBatch.set(res.feedback);
                    this.lastSessionData.set(iterationPayload);
                }
                if (res.text && res.text.length > 0) {
                    this.currentBatch.set(res.text);
                    this.userAnswers.set({});
                    this.previousIteration.set([]); 
                    this.answered.set(false);
                    this.audioCache.set({}); // clear cache
                    
                    // Preload audios
                    res.text.forEach((task: AiTask) => {
                        this.dataService.synthesizeAudio(task.text, this.langCode()).subscribe({
                            next: (blob) => {
                                const url = URL.createObjectURL(blob);
                                this.audioCache.update(prev => ({ ...prev, [task.id]: url }));
                            }
                        });
                    });

                    if (this.feedbackBatch().length > 0) {
                        this.screen.set('feedback');
                    } else {
                        this.screen.set('quiz');
                    }
                } else {
                    this.screen.set('finished');
                    launchConfetti();
                }
            },
            error: (err) => {
                console.error("Failed to generate AI content", err);
                alert("Fehler bei der AI Generation. Versuche es später erneut.");
                this.screen.set('welcome');
            }
        });
    }

    playTaskAudio(task: AiTask): void {
        this.stopAnyAudio();
        const cachedUrl = this.audioCache()[task.id];
        if (cachedUrl) {
            this.currentAudio = new Audio(cachedUrl);
            this.currentAudio.play().catch(e => console.error("Audio playback error", e));
        } else {
            // Fallback if not loaded yet
            this.dataService.synthesizeAudio(task.text, this.langCode()).subscribe({
                next: (blob) => {
                    const url = URL.createObjectURL(blob);
                    this.audioCache.update(prev => ({ ...prev, [task.id]: url }));
                    this.currentAudio = new Audio(url);
                    this.currentAudio.play().catch(e => console.error("Audio playback error", e));
                }
            });
        }
    }

    stopAnyAudio(): void {
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.currentTime = 0;
            this.currentAudio = null;
        }
    }

    // -- WAV Recording Logic --
    async toggleRecording(taskId: number): Promise<void> {
        if (this.isRecording() === taskId) {
            this.stopRecording();
        } else {
            await this.startRecording(taskId);
        }
    }

    private async startRecording(taskId: number): Promise<void> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);

            const leftChannel: Float32Array[] = [];
            let recordingLength = 0;

            processor.onaudioprocess = (e) => {
                const left = e.inputBuffer.getChannelData(0);
                leftChannel.push(new Float32Array(left));
                recordingLength += 4096;
            };

            source.connect(processor);
            processor.connect(audioContext.destination);

            this.mediaRecorder = {
                stop: () => {
                    processor.disconnect();
                    source.disconnect();
                    audioContext.close();
                    stream.getTracks().forEach(t => t.stop());
                    
                    const samples = new Float32Array(recordingLength);
                    let offset = 0;
                    for (let i = 0; i < leftChannel.length; i++) {
                        samples.set(leftChannel[i], offset);
                        offset += leftChannel[i].length;
                    }
                    
                    const wavBlob = this.encodeWAV(samples, audioContext.sampleRate);
                    this.processAudioBlob(wavBlob, taskId);
                }
            };

            this.isRecording.set(taskId);
        } catch (e) {
            console.error("Microphone access denied or error", e);
            alert("Konnte nicht auf das Mikrofon zugreifen.");
        }
    }

    private encodeWAV(samples: Float32Array, sampleRate: number): Blob {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);
        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Blob([view], { type: 'audio/wav' });
    }

    private stopRecording(): void {
        if (this.mediaRecorder) this.mediaRecorder.stop();
        this.isRecording.set(null);
    }

    private processAudioBlob(audioBlob: Blob, taskId: number): void {
        this.isAudioProcessing.set(taskId);
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
            const base64data = (reader.result as string).split(',')[1];
            this.dataService.transcribeAudio(base64data, this.langCode()).subscribe({
                next: (res) => {
                    this.userAnswers.update(prev => ({ ...prev, [taskId]: res.text }));
                    this.isAudioProcessing.set(null);
                },
                error: (err) => {
                    console.error("STT Error", err);
                    alert("Konnte Audio nicht transkribieren.");
                    this.isAudioProcessing.set(null);
                }
            });
        };
    }

    submitAll(): void {
        const tasks = this.currentBatch();
        const answers = this.userAnswers();
        
        const iteration = tasks.map(task => ({
            id: task.id,
            text: task.text,
            user: answers[task.id] || ''
        }));

        this.previousIteration.set(iteration);
        this.answered.set(true);
        
        // After submitting all, we immediately fetch next batch to see feedback
        this.fetchNextBatch();
    }

    restartApp(): void {
        this.screen.set('welcome');
    }

    continueAfterFeedback(): void {
        this.screen.set('quiz');
    }
}
