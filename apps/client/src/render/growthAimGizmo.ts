/**
 * The growth-aim gizmo: its meshes, its overlay canvas, and when it is visible.
 *
 * Moved out of `main.ts` as the first module on the new `AppContext`. What moved
 * is the *rendering* half of growth aiming - building the ring/arrow/drop-marker
 * and drawing them above the plant canvas - because it is the half that needs
 * nothing but the camera and the plant mirror.
 *
 * What deliberately stayed behind: the aim *state* (yaw, pitch, drag mapping,
 * commit). That half talks to the growth-selection state machine and the socket,
 * and it moves once the context carries those.
 */
import * as THREE from 'three';
import type { AppContext } from '../app/appContext.ts';
import type { PlantNodeData } from '../renderers/plant/plantNodeData.ts';

/** Everything the overlay needs from the aim state it does not own. */
export interface GrowthAimGizmoHooks {
  /** The option the player is currently aiming, if any. */
  getDrawingData: () => { nodeId: string; selectedOptionType?: string } | null;
  /** True when the player moved the ring onto the part's surface. */
  isAnchorOnNodeSurface: () => boolean;
  /** World point the aim ring is anchored to; written by the aim code. */
  ringAnchor: THREE.Vector3;
  /** True when the arrow's tip is off the soil, so the drop marker means something. */
  isDropVisible: () => boolean;
  /** Radii/limits from `render.json`; may be null before config arrives. */
  renderConfig: () => {
    growthAimHeadRadius?: number;
    growthAimHeadLength?: number;
    growthAimTipRadius?: number;
  } | null;
  /** As drawn: the renderer's own visual radius for a node. Not re-derived here. */
  visualRadiusOf: (node: PlantNodeData) => number;
  /** As drawn: the node's mesh centre, including the seed's raised body. */
  drawCentreOf: (node: PlantNodeData) => THREE.Vector3;
}

/** The meshes, once built. */
export interface GrowthAimParts {
  group: THREE.Group;
  ring: THREE.Mesh;
  tube: THREE.Mesh;
  head: THREE.Mesh;
  tip: THREE.Mesh;
  mouthDisc: THREE.Mesh;
  tipRing: THREE.Mesh;
  dropPost: THREE.Mesh;
  dropDisc: THREE.Mesh;
}

export interface GrowthAimGizmo {
  /** Build on first use; returns the meshes. */
  ensure(): GrowthAimParts;
  /** Hide the whole overlay (aim cancelled). */
  hide(): void;
  /** Make the overlay and its canvas visible again. */
  show(): void;
  /** Per-frame: hide what the plant stands in front of, then draw. */
  render(): void;
  /** Radius the ring was last built at; kept by the caller for rebuild checks. */
  readonly parts: GrowthAimParts | null;
}

export function createGrowthAimGizmo(ctx: AppContext, hooks: GrowthAimGizmoHooks): GrowthAimGizmo {
  let parts: GrowthAimParts | null = null;
  let overlay: THREE.WebGLRenderer | null = null;
  let overlayScene: THREE.Scene | null = null;

  const ensure = (): GrowthAimParts => {
    if (parts) return parts;
    const config = hooks.renderConfig();
    const group = new THREE.Group();
    group.name = 'growth-aim-gizmo';
    group.visible = false;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.028, 6, 64),
      new THREE.MeshBasicMaterial({ color: 0xf2e3a0, depthTest: false, depthWrite: false }),
    );
    ring.renderOrder = 1000;

    const arrowMaterial = new THREE.MeshBasicMaterial({
      color: 0x9ede63,
      depthTest: false,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), arrowMaterial);
    tube.renderOrder = 1001;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(
        config?.growthAimHeadRadius ?? 0.032,
        config?.growthAimHeadLength ?? 0.095,
        12,
      ),
      arrowMaterial,
    );
    head.renderOrder = 1001;

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(config?.growthAimTipRadius ?? 0.014, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false }),
    );
    tip.renderOrder = 1002;

    // The mouth the part leaves from. A translucent fill makes the base ring read
    // as a hole in the part rather than a hoop floating near it.
    const mouthDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({
        color: 0xf2e3a0,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mouthDisc.renderOrder = 999;

    // The landing ring: same radius, at the far end of the arrow, perpendicular
    // to the aim. Its perspective distortion is what tells the eye the arrow has
    // depth, and it marks exactly where the new part will end.
    const tipRing = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.02, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, depthTest: false, depthWrite: false }),
    );
    tipRing.renderOrder = 1000;

    const dropMaterial = new THREE.MeshBasicMaterial({
      color: 0xcbdcb4,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
      depthWrite: false,
    });
    const dropPost = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), dropMaterial);
    dropPost.renderOrder = 998;
    const dropDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 28), dropMaterial);
    dropDisc.renderOrder = 998;

    group.add(ring, mouthDisc, tube, head, tip, tipRing, dropPost, dropDisc);
    const scene = new THREE.Scene();
    scene.add(group);
    overlayScene = scene;

    // Its own canvas above the plant/ground one: geometry in the main scene is
    // covered by the ground the moment the arrow points below the surface
    // (roots, radicles).
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.domElement.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;visibility:hidden;';
    document.getElementById('app')?.appendChild(renderer.domElement);
    // The overlay fills the game element, not the window, so start from the box
    // it was just given (the render loop keeps it in step after this).
    renderer.setSize(
      renderer.domElement.clientWidth || window.innerWidth,
      renderer.domElement.clientHeight || window.innerHeight,
      false,
    );
    overlay = renderer;

    parts = { group, ring, tube, head, tip, mouthDisc, tipRing, dropPost, dropDisc };
    return parts;
  };

  const hide = (): void => {
    if (parts) parts.group.visible = false;
    if (overlay) overlay.domElement.style.visibility = 'hidden';
  };

  const show = (): void => {
    ensure().group.visible = true;
    if (overlay) overlay.domElement.style.visibility = 'visible';
  };

  /**
   * Hide only what the plant is genuinely in front of.
   *
   * This used to hide the whole gizmo - ring, arrow, head, tip, mouth disc and
   * ground marker - if any own-plant node sphere sat between the camera and the
   * ring anchor. Orbiting a leaf across the anchor therefore blinked the aim
   * out entirely. The ring is the one part that must disappear when another
   * part covers it (it has to read as sitting *on* the plant); the arrow is what
   * the player is steering and the marker is what ties it to the ground, so both
   * stay.
   */
  const syncVisibility = (current: GrowthAimParts): void => {
    if (!current.group.visible) return;
    const data = hooks.getDrawingData();
    if (!data) return;
    const anchor = hooks.ringAnchor;
    const toRing = anchor.clone().sub(ctx.camera.position);
    const ringDistance = toRing.length();
    if (ringDistance <= 1e-4) return;
    const ray = new THREE.Raycaster(
      ctx.camera.position,
      toRing.normalize(),
      0,
      ringDistance - 0.02,
    );
    let hostOccluded = false;
    for (const [id, node] of ctx.plantNodes) {
      if (!node.isOwnPlant) continue;
      // The selected node is the ring's host: the ring lies on it, so it can
      // never be the thing in front of its own anchor.
      if (id === data.nodeId) continue;
      const radius = Math.max(0.02, hooks.visualRadiusOf(node));
      const centre = hooks.drawCentreOf(node);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectSphere(new THREE.Sphere(centre, radius * 0.92), hit)) {
        hostOccluded = true;
        break;
      }
    }
    const dropVisible = hooks.isDropVisible();
    current.ring.visible = !hostOccluded;
    current.mouthDisc.visible = !hostOccluded;
    current.tube.visible = true;
    current.head.visible = true;
    current.tip.visible = true;
    current.tipRing.visible = true;
    current.dropPost.visible = dropVisible;
    current.dropDisc.visible = dropVisible;
  };

  const render = (): void => {
    if (!overlay || !overlayScene || !parts?.group.visible) return;
    syncVisibility(parts);
    // Keep the overlay's drawing buffer in step with the page. It shares the
    // main camera's projection, so a stale buffer is what makes a world-space
    // gizmo drift away from the plant under the cursor.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (Math.abs(overlay.getPixelRatio() - pixelRatio) > 0.001) {
      overlay.setPixelRatio(pixelRatio);
    }
    const width = overlay.domElement.clientWidth || window.innerWidth;
    const height = overlay.domElement.clientHeight || window.innerHeight;
    const size = overlay.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) {
      overlay.setSize(width, height, false);
    }
    overlay.render(overlayScene, ctx.camera);
  };

  return {
    ensure,
    hide,
    show,
    render,
    get parts() {
      return parts;
    },
  };
}
