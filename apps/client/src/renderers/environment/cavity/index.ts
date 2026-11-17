/**
 * The Root Sight cavity, as a small package instead of one 730-line file.
 *
 * - `profile.ts`   the shape numbers and the depth budget; no THREE, no GLSL.
 * - `placement.ts` where the bowl sits and how far its rim and floor may go.
 * - `clip.ts`      when the shell may paint, given where the eye is.
 * - `bowlMesh.ts`  the bowl geometry and its shader.
 * - `wallMesh.ts`  the soil ring that closes the aperture's cut edge.
 * - `update.ts`    the only module that mutates a mesh.
 *
 * Nothing above imports downward except into `profile.ts`, so the pit's maths
 * can be tested without a renderer and the shader can change without touching
 * the placement rules.
 */
export * from './bowlMesh.ts';
export * from './clip.ts';
export * from './placement.ts';
export * from './profile.ts';
export * from './shape.ts';
export * from './skirtMesh.ts';
export * from './update.ts';
