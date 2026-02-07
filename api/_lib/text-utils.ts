/**
 * Recursively replaces 'ß' with 'ss' throughout any data structure.
 * Used for Swiss German spelling conversion.
 */
export function replaceEszett<T>(obj: T): T {
    if (typeof obj === 'string') {
        return obj.replace(/ß/g, 'ss') as T;
    } else if (Array.isArray(obj)) {
        return obj.map(item => replaceEszett(item)) as T;
    } else if (obj !== null && typeof obj === 'object') {
        const newObj: Record<string, unknown> = {};
        for (const key in obj) {
            newObj[key] = replaceEszett((obj as Record<string, unknown>)[key]);
        }
        return newObj as T;
    }
    return obj;
}
