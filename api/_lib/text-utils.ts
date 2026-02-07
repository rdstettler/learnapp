/**
 * Recursively replaces 'ß' with 'ss' throughout any data structure.
 * Used for Swiss German spelling conversion.
 */
export function replaceEszett(obj: any): any {
    if (typeof obj === 'string') {
        return obj.replace(/ß/g, 'ss');
    } else if (Array.isArray(obj)) {
        return obj.map(item => replaceEszett(item));
    } else if (obj !== null && typeof obj === 'object') {
        const newObj: any = {};
        for (const key in obj) {
            newObj[key] = replaceEszett(obj[key]);
        }
        return newObj;
    }
    return obj;
}
