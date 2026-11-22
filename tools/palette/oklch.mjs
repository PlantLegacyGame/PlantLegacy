/**
 * The palette tool's view of the conversion: the implementation lives in
 * `packages/shared/src/color`, because the client needs the same numbers when it
 * resolves the UI's role tokens at boot. Re-exported here so the tool and its
 * tests import one module.
 */
export {
  isLightStep,
  oklchToHex,
  oklchToLinearRgb,
} from '../../packages/shared/src/color/oklch.ts';
