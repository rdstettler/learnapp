import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
    name: 'markdown',
    standalone: true
})
export class MarkdownPipe implements PipeTransform {

    transform(value: string): string {
        if (!value) return '';

        let html = value;

        // 1. Sanitize (basic) - actually, for a learning app where content comes from AI/Backend 
        // and we want to render HTML structural tags, we shouldn't escape everything 
        // IF we trust the source. Assuming we trust the backend/AI.
        // If we escape first, then we can't add our own tags easily without re-scaping.
        // Let's assume we proceed with replacing patterns with HTML tags.
        // Ideally we'd use a sanitizer service, but for this pipe let's just do text replacement.

        // Escape existing HTML to prevent XSS if the content could be malicious
        // html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // 2. Bold (**text**)
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // 3. Italic (*text* or _text_)
        // html = html.replace(/\*(.*?)\*/g, '<em>$1</em>'); // Risk of matching list items *
        html = html.replace(/_(.*?)_/g, '<em>$1</em>');

        // 4. Line processing for Lists and Paragraphs
        const lines = html.split('\n');
        let output = '';
        let inUl = false;
        let inOl = false;

        lines.forEach(line => {
            let trimmed = line.trim();

            if (!trimmed) {
                // Empty line
                return;
            }

            if (trimmed.startsWith('- ')) {
                // Unordered list
                if (!inUl) {
                    if (inOl) { output += '</ol>'; inOl = false; }
                    output += '<ul style="margin: 0.5rem 0; padding-left: 1.5rem;">';
                    inUl = true;
                }
                output += `<li>${trimmed.substring(2)}</li>`;
            } else if (/^\d+\.\s/.test(trimmed)) {
                // Ordered list
                if (!inOl) {
                    if (inUl) { output += '</ul>'; inUl = false; }
                    output += '<ol style="margin: 0.5rem 0; padding-left: 1.5rem;">';
                    inOl = true;
                }
                // Remove the number and dot, let ol handle it? 
                // Or keep it if we want specific numbers. markdown renderers usually let ol handle it.
                output += `<li>${trimmed.replace(/^\d+\.\s/, '')}</li>`;
            } else {
                // Regular line
                if (inUl) { output += '</ul>'; inUl = false; }
                if (inOl) { output += '</ol>'; inOl = false; }

                output += `<p style="margin: 0 0 0.5rem 0;">${trimmed}</p>`;
            }
        });

        if (inUl) output += '</ul>';
        if (inOl) output += '</ol>';

        return output;
    }

}
