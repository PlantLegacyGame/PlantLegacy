export type GrowthSelectionState =
  | 'hidden'
  | 'loading'
  | 'options_visible'
  | 'option_selected'
  | 'drawing'
  | 'preview';

export interface GrowthOptionView {
  type: string;
  label: string;
  energyCost: number;
  biomassGain: number;
  expectedSeconds: number;
  available: boolean;
  reason?: string;
  risk?: string;
  waterCost?: number;
  nutrientCost?: number;
  mineralCost?: number;
}

export interface GrowthConditionsView {
  // Tile-based (for germination)
  light: number;
  moisture: number;
  minLight: number;
  minMoisture: number;
  // Plant storage-based (for growth)
  storedWater?: number;
  storedMinerals?: number;
  growthMinWater?: number;
  growthMinMinerals?: number;
  ok: boolean;
  growthOk?: boolean;
}

export interface GrowthDrawingData {
  nodeId: string;
  nodePosition: { x: number; y: number; z: number };
  selectedOptionType: string;
  selectedOptionLabel: string;
  startPosition: { x: number; y: number; z: number };
  currentEndPosition: { x: number; y: number; z: number } | null;
  /** 3D path traced by mouse movement (world-space samples), starts at node position. */
  path: { x: number; y: number; z: number }[];
  direction: { x: number; y: number; z: number } | null;
  isValid: boolean;
  validationReason?: string;
  distance: number;
}

export interface GrowthSelectionViewData {
  nodeId: string;
  options: GrowthOptionView[];
  conditions: GrowthConditionsView | null;
  isSeed: boolean;
  nodeType: string;
  biomass: number;
  energy: number;
}

export interface GrowthSelectionStateMachine {
  state: GrowthSelectionState;
  selectedNodeId: string | null;
  options: GrowthOptionView[];
  conditions: GrowthConditionsView | null;
  isSeed: boolean;
  nodeType: string;
  loading: boolean;
  visible: boolean;
  drawingData: GrowthDrawingData | null;
  selectedOptionType: string | null;
  selectedOptionLabel: string | null;
}

export function createGrowthSelectionStateMachine(): GrowthSelectionStateMachine {
  return {
    state: 'hidden',
    selectedNodeId: null,
    options: [],
    conditions: null,
    isSeed: false,
    nodeType: '',
    loading: false,
    visible: false,
    drawingData: null,
    selectedOptionType: null,
    selectedOptionLabel: null,
  };
}

export function growthSelectionStateMachineRequestOptions(
  machine: GrowthSelectionStateMachine,
  nodeId: string,
): void {
  if (machine.state !== 'hidden') return;

  machine.state = 'loading';
  machine.selectedNodeId = nodeId;
  machine.options = [];
  machine.conditions = null;
  machine.isSeed = false;
  machine.nodeType = '';
  machine.loading = true;
  machine.visible = true;
  machine.drawingData = null;
}

export function growthSelectionStateMachineRenderOptions(
  machine: GrowthSelectionStateMachine,
  data: GrowthSelectionViewData,
): void {
  if (machine.state !== 'loading') return;

  machine.state = 'options_visible';
  machine.options = data.options;
  machine.conditions = data.conditions;
  machine.isSeed = data.isSeed;
  machine.nodeType = data.nodeType;
  machine.loading = false;
  machine.visible = true;
  machine.drawingData = null;
  machine.selectedOptionType = null;
  machine.selectedOptionLabel = null;
}

export function growthSelectionStateMachineSelectOption(
  machine: GrowthSelectionStateMachine,
  optionType: string,
  optionLabel: string,
): void {
  if (machine.state !== 'options_visible') return;
  machine.state = 'option_selected';
  machine.selectedOptionType = optionType;
  machine.selectedOptionLabel = optionLabel;
}

export function growthSelectionStateMachineStartDrawing(
  machine: GrowthSelectionStateMachine,
  nodeId: string,
  nodePosition: { x: number; y: number; z: number },
  optionType: string,
  optionLabel: string,
): void {
  console.log(
    '[GrowthSM] startDrawing called, state:',
    machine.state,
    'selectedNodeId:',
    machine.selectedNodeId,
    'nodeId:',
    nodeId,
  );
  if (machine.state !== 'option_selected' && machine.state !== 'options_visible') return;
  if (!machine.selectedNodeId || machine.selectedNodeId !== nodeId) return;

  // If coming from options_visible, use the provided option; if from option_selected, use stored
  const finalOptionType = machine.selectedOptionType ?? optionType;
  const finalOptionLabel = machine.selectedOptionLabel ?? optionLabel;

  machine.state = 'drawing';
  machine.drawingData = {
    nodeId,
    nodePosition,
    selectedOptionType: finalOptionType,
    selectedOptionLabel: finalOptionLabel,
    startPosition: { ...nodePosition },
    currentEndPosition: null,
    path: [{ ...nodePosition }],
    direction: null,
    isValid: false,
    validationReason: 'Move mouse to trace growth path',
    distance: 0,
  };
}

export function growthSelectionStateMachineUpdateDrawing(
  machine: GrowthSelectionStateMachine,
  endPosition: { x: number; y: number; z: number },
  validationResult: { isValid: boolean; reason?: string; distance: number },
): void {
  if (machine.state !== 'drawing' || !machine.drawingData) return;

  const { startPosition } = machine.drawingData;
  // Append to traced path when moved enough (keeps route the mouse took).
  const path = machine.drawingData.path;
  const prev = path[path.length - 1] ?? startPosition;
  const segDx = endPosition.x - prev.x;
  const segDy = endPosition.y - prev.y;
  const segDz = endPosition.z - prev.z;
  if (segDx * segDx + segDy * segDy + segDz * segDz > 0.0025) {
    path.push({ ...endPosition });
    if (path.length > 256) path.splice(1, path.length - 256);
  } else if (path.length > 1) {
    path[path.length - 1] = { ...endPosition };
  }

  // Direction for growth intent: prefer end-tangent of traced path, fallback to start->end.
  let dirFrom = startPosition;
  let dirTo = endPosition;
  if (path.length >= 3) {
    // use last segment with some length
    for (let i = path.length - 1; i >= 1; i--) {
      const a = path[i - 1];
      const b = path[i];
      const l = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (l > 0.03) {
        dirFrom = a;
        dirTo = b;
        break;
      }
    }
  }
  let dx = dirTo.x - dirFrom.x;
  let dy = dirTo.y - dirFrom.y;
  let dz = dirTo.z - dirFrom.z;
  let distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance < 1e-6) {
    dx = endPosition.x - startPosition.x;
    dy = endPosition.y - startPosition.y;
    dz = endPosition.z - startPosition.z;
    distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const direction =
    distance > 0 ? { x: dx / distance, y: dy / distance, z: dz / distance } : { x: 0, y: 1, z: 0 };

  // path length for display
  let pathLen = 0;
  for (let i = 1; i < path.length; i++) {
    pathLen += Math.hypot(
      path[i].x - path[i - 1].x,
      path[i].y - path[i - 1].y,
      path[i].z - path[i - 1].z,
    );
  }

  machine.drawingData.currentEndPosition = endPosition;
  machine.drawingData.direction = direction;
  machine.drawingData.distance = pathLen > 0 ? pathLen : distance;
  machine.drawingData.isValid = validationResult.isValid;
  machine.drawingData.validationReason = validationResult.reason;
}

export function growthSelectionStateMachineConfirmDrawing(machine: GrowthSelectionStateMachine): {
  nodeId: string;
  optionType: string;
  direction: { x: number; y: number; z: number };
  distance: number;
} | null {
  if (machine.state !== 'drawing' || !machine.drawingData) return null;
  if (!machine.drawingData.isValid) return null;
  if (!machine.drawingData.direction) return null;

  const result = {
    nodeId: machine.drawingData.nodeId,
    optionType: machine.drawingData.selectedOptionType,
    direction: machine.drawingData.direction,
    distance: machine.drawingData.distance,
  };

  machine.state = 'options_visible';
  machine.drawingData = null;
  machine.selectedOptionType = null;
  machine.selectedOptionLabel = null;
  return result;
}

export function growthSelectionStateMachineCancelDrawing(
  machine: GrowthSelectionStateMachine,
): void {
  if (machine.state !== 'drawing') return;
  machine.state = 'options_visible';
  machine.drawingData = null;
  machine.selectedOptionType = null;
  machine.selectedOptionLabel = null;
}

export function growthSelectionStateMachineHide(machine: GrowthSelectionStateMachine): void {
  machine.state = 'hidden';
  machine.selectedNodeId = null;
  machine.options = [];
  machine.conditions = null;
  machine.loading = false;
  machine.visible = false;
  machine.drawingData = null;
  machine.selectedOptionType = null;
  machine.selectedOptionLabel = null;
}

export function growthSelectionStateMachineReset(machine: GrowthSelectionStateMachine): void {
  growthSelectionStateMachineHide(machine);
}

export function growthSelectionStateMachineGetState(
  machine: GrowthSelectionStateMachine,
): GrowthSelectionState {
  return machine.state;
}

export function growthSelectionStateMachineIsVisible(
  machine: GrowthSelectionStateMachine,
): boolean {
  return machine.visible;
}

export function growthSelectionStateMachineIsLoading(
  machine: GrowthSelectionStateMachine,
): boolean {
  return machine.loading;
}

export function growthSelectionStateMachineIsDrawing(
  machine: GrowthSelectionStateMachine,
): boolean {
  return machine.state === 'drawing';
}

export function growthSelectionStateMachineGetDrawingData(
  machine: GrowthSelectionStateMachine,
): GrowthDrawingData | null {
  return machine.drawingData;
}
