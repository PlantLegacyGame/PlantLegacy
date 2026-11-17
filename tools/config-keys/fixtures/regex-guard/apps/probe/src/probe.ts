// A regex whose body contains both comment openers: if the scanner mistakes it
// for a comment, the literal below disappears from its view.
export const guard = /[/*]/;
export const read = 'probe_key';
