declare const payload: Record<string, number>;
// A regex whose body holds both comment openers: if the scanner mistakes it for a
// comment, every literal below stops counting as a read.
export const guard = /[/*]/;
export const quoted = 'quoted_key';
export const afterRegex = 'after_regex_key';
export const fromPayload = payload.identifier_key;
