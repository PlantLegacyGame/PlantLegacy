import * as THREE from 'three';

const plantVert = `in vec3 aPosition;
in vec3 aNormal;
in float aBiomass;
in float aNodeType;
in float aHealth;
in float aMutationFlags;
in float aTubeU;
in float aTubeV;

uniform float uTime;
uniform float uWindStrength;
uniform float uWindSpeed;
uniform float uHealthTintStrength;
uniform float uMutation0Param;
uniform float uMutation1Param;
uniform float uMutation2Param;
uniform float uLODLevel;
uniform vec3 uSunDirection;
uniform vec3 uCameraPosition;
uniform vec3 uRootColor;
uniform vec3 uCanopyColor;
uniform vec3 uLeafColor;

out vec3 vNormal;
out vec3 vWorldPos;
out float vBiomass;
out float vNodeType;
out float vHealth;
out float vMutationFlags;
out float vTubeU;
out float vTubeV;
out float vIsLeaf;

void main() {
    vWorldPos = (modelMatrix * vec4(aPosition, 1.0)).xyz;
    vNormal = normalize(mat3(modelMatrix) * aNormal);
    vBiomass = aBiomass;
    vNodeType = aNodeType;
    vHealth = aHealth;
    vMutationFlags = aMutationFlags;
    vTubeU = aTubeU;
    vTubeV = aTubeV;

    float isLeaf = step(1.5, aNodeType);
    vIsLeaf = isLeaf;

    float heightFactor = clamp(vWorldPos.y / 60.0, 0.0, 1.0);
    float depthFactor = clamp(-vWorldPos.y / 60.0, 0.0, 1.0);
    float moveFactor = max(heightFactor, depthFactor);

    float wind1 = sin(uTime * uWindSpeed + vWorldPos.x * 0.4 + vWorldPos.z * 0.4) * 0.5 + 0.5;
    float wind2 = sin(uTime * uWindSpeed * 1.3 + vWorldPos.y * 0.2 + vWorldPos.z * 0.3) * 0.3 + 0.3;
    float wind = (wind1 * 0.7 + wind2 * 0.3) * uWindStrength * moveFactor * 0.6;

    vWorldPos.x += wind * sin(vWorldPos.z * 0.5 + uTime);
    vWorldPos.z += wind * cos(vWorldPos.x * 0.5 + uTime);

    if (isLeaf > 0.5) {
        float curl = sin(uTime * uWindSpeed * 2.0 + vTubeV * 6.28) * 0.1;
        vWorldPos.x += curl * cos(vTubeV * 6.28);
        vWorldPos.z += curl * sin(vTubeV * 6.28);
    }

    vec4 mvPosition = modelViewMatrix * vec4(vWorldPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
}
`;

const plantFrag = `in vec3 vNormal;
in vec3 vWorldPos;
in float vBiomass;
in float vNodeType;
in float vHealth;
in float vMutationFlags;
in float vTubeU;
in float vTubeV;
in float vIsLeaf;

out vec4 fragColor;

uniform float uTime;
uniform float uHealthTintStrength;
uniform float uMutation0Param;
uniform float uMutation1Param;
uniform float uMutation2Param;
uniform vec3 uSunDirection;
uniform vec3 uCameraPosition;
uniform vec3 uRootColor;
uniform vec3 uCanopyColor;
uniform vec3 uLeafColor;

float noise(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
}

float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 5; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

float triplanarNoise(vec3 worldPos, vec3 normal) {
    vec3 n = abs(normal);
    float sum = n.x + n.y + n.z + 0.0001;
    vec3 blend = n / sum;
    float nx = fbm(vec3(worldPos.yz * 4.0, uTime), 4);
    float ny = fbm(vec3(worldPos.xz * 4.0, uTime), 4);
    float nz = fbm(vec3(worldPos.xy * 4.0, uTime), 4);
    return nx * blend.x + ny * blend.y + nz * blend.z;
}

void main() {
    float isRoot = step(0.5, vNodeType);
    float isLeaf = vIsLeaf;

    vec3 baseColor = mix(uCanopyColor, uRootColor, isRoot);
    baseColor = mix(baseColor, uLeafColor, isLeaf);

    if (isLeaf < 0.5) {
        float texture = triplanarNoise(vWorldPos, vNormal);
        baseColor += vec3(texture * 0.08);
    }

    float healthFactor = clamp(vHealth, 0.0, 1.0);
    vec3 unhealthyColor = vec3(0.55, 0.5, 0.45);
    float tintMix = 1.0 - healthFactor * uHealthTintStrength;
    baseColor = mix(unhealthyColor, baseColor, tintMix);

    float mutation0 = mod(vMutationFlags, 2.0);
    float mutation1 = mod(floor(vMutationFlags / 2.0), 2.0);
    float mutation2 = mod(floor(vMutationFlags / 4.0), 2.0);

    if (isLeaf > 0.5) {
        baseColor += vec3(mutation2 * uMutation2Param * 0.25);
    }

    float NdotL = max(dot(vNormal, uSunDirection), 0.0);
    vec3 lit = baseColor * (0.35 + 0.65 * NdotL);

    vec3 viewDir = normalize(uCameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
    lit += vec3(0.25, 0.3, 0.35) * rim * 0.6;

    float emissive = mutation0 * uMutation0Param * 0.5;
    lit += vec3(0.3, 0.5, 0.8) * emissive;

    lit *= 0.6 + vBiomass * 0.4;

    fragColor = vec4(lit, 1.0);
}
`;

interface PlantNodeData {
  id: string;
  position: THREE.Vector3;
  type: number;
  radius: number;
  parentId: string | null;
  age: number;
  health: number;
  mutationFlags: number;
  biomass: number;
}

interface PlantRendererConfig {
  maxNodesPerPlant: number;
  tubeRingCount: number;
  tubeLengthSegments: number;
  leafCountPerNode: number;
  leafSize: number;
  leafLengthWidthRatio: number;
  l0Distance: number;
  l1Distance: number;
  l2Distance: number;
  triangleBudgetL0: number;
  triangleBudgetL1: number;
  windStrength: number;
  windSpeed: number;
  healthTintStrength: number;
  mutation0Param: number;
  mutation1Param: number;
  mutation2Param: number;
  rootSightEnabled: boolean;
  rootSightOpacity: number;
  canopySightEnabled: boolean;
  photosynthesisViz: boolean;
  waterFlowViz: boolean;
  nutrientFlowViz: boolean;
  nodeSize: number;
}

const DEFAULT_CONFIG: PlantRendererConfig = {
  maxNodesPerPlant: 1000,
  tubeRingCount: 12,
  tubeLengthSegments: 4,
  leafCountPerNode: 3,
  leafSize: 1.5,
  leafLengthWidthRatio: 2.5,
  l0Distance: 50.0,
  l1Distance: 150.0,
  l2Distance: 500.0,
  triangleBudgetL0: 1500,
  triangleBudgetL1: 800,
  windStrength: 0.3,
  windSpeed: 1.0,
  healthTintStrength: 0.5,
  mutation0Param: 1.0,
  mutation1Param: 1.5,
  mutation2Param: 0.3,
  rootSightEnabled: true,
  rootSightOpacity: 0.6,
  canopySightEnabled: true,
  photosynthesisViz: true,
  waterFlowViz: true,
  nutrientFlowViz: true,
  nodeSize: 1.0,
};

function mulberry32(a: number): () => number {
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PlantRenderer {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private config: PlantRendererConfig;

  private plantMaterial!: THREE.ShaderMaterial;

  private tubeMesh!: THREE.Mesh;
  private tubeGeometry!: THREE.BufferGeometry;

  private leafMesh!: THREE.InstancedMesh;
  private leafGeometry!: THREE.BufferGeometry;

  private maxTubes: number;
  private maxLeaves: number;

  private tubePositions: Float32Array;
  private tubeNormals: Float32Array;
  private tubeBiomass: Float32Array;
  private tubeNodeType: Float32Array;
  private tubeHealth: Float32Array;
  private tubeMutationFlags: Float32Array;
  private tubeTubeU: Float32Array;
  private tubeTubeV: Float32Array;
  private tubeIndices: Uint32Array;

  private leafInstanceMatrix: Float32Array;
  private leafInstanceColor: Float32Array;
  private leafInstancePhase: Float32Array;

  private tubeVertexCount = 0;
  private tubeIndexCount = 0;
  private leafInstanceCount = 0;

  private nodeVertexOffset = new Map<string, number>();
  private nodeInstanceOffset = new Map<string, number>();
  private knownNodes = new Map<string, PlantNodeData>();

  private startTime: number;

  constructor(
    _renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: Partial<PlantRendererConfig> = {},
  ) {
    this.scene = scene;
    this.camera = camera;
    this.config = { ...DEFAULT_CONFIG, ...config };

    const maxNodes = this.config.maxNodesPerPlant;
    const ringsPerSegment = this.config.tubeLengthSegments + 1;
    const capRingsPerSegment = 2;
    const maxRingsPerSegment = (ringsPerSegment + capRingsPerSegment) * this.config.tubeRingCount;
    const maxIndicesPerSegment =
      this.config.tubeLengthSegments * this.config.tubeRingCount * 6 +
      this.config.tubeRingCount * 6 * 2;

    this.maxTubes = maxNodes;
    this.maxLeaves = maxNodes * this.config.leafCountPerNode;

    this.tubePositions = new Float32Array(this.maxTubes * maxRingsPerSegment * 3);
    this.tubeNormals = new Float32Array(this.maxTubes * maxRingsPerSegment * 3);
    this.tubeBiomass = new Float32Array(this.maxTubes * maxRingsPerSegment);
    this.tubeNodeType = new Float32Array(this.maxTubes * maxRingsPerSegment);
    this.tubeHealth = new Float32Array(this.maxTubes * maxRingsPerSegment);
    this.tubeMutationFlags = new Float32Array(this.maxTubes * maxRingsPerSegment);
    this.tubeTubeU = new Float32Array(this.maxTubes * maxRingsPerSegment);
    this.tubeTubeV = new Float32Array(this.maxTubes * maxRingsPerSegment);
    this.tubeIndices = new Uint32Array(this.maxTubes * maxIndicesPerSegment);

    this.leafInstanceMatrix = new Float32Array(this.maxLeaves * 16);
    this.leafInstanceColor = new Float32Array(this.maxLeaves * 4);
    this.leafInstancePhase = new Float32Array(this.maxLeaves);

    this.startTime = Date.now();

    this.initShaders();
    this.initGeometry();
  }

  private initShaders(): void {
    this.plantMaterial = new THREE.ShaderMaterial({
      vertexShader: plantVert,
      fragmentShader: plantFrag,
      glslVersion: THREE.GLSL3,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uWindStrength: { value: this.config.windStrength },
        uWindSpeed: { value: this.config.windSpeed },
        uHealthTintStrength: { value: this.config.healthTintStrength },
        uMutation0Param: { value: this.config.mutation0Param },
        uMutation1Param: { value: this.config.mutation1Param },
        uMutation2Param: { value: this.config.mutation2Param },
        uLODLevel: { value: 0 },
        uSunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
        uCameraPosition: { value: new THREE.Vector3() },
        uRootColor: { value: new THREE.Color(0x5d4037) },
        uCanopyColor: { value: new THREE.Color(0x4caf50) },
        uLeafColor: { value: new THREE.Color(0x8bc34a) },
        modelMatrix: { value: new THREE.Matrix4() },
      },
    });
  }

  private initGeometry(): void {
    this.tubeGeometry = new THREE.BufferGeometry();
    this.tubeGeometry.setAttribute('aPosition', new THREE.BufferAttribute(this.tubePositions, 3));
    this.tubeGeometry.setAttribute('aNormal', new THREE.BufferAttribute(this.tubeNormals, 3));
    this.tubeGeometry.setAttribute('aBiomass', new THREE.BufferAttribute(this.tubeBiomass, 1));
    this.tubeGeometry.setAttribute('aNodeType', new THREE.BufferAttribute(this.tubeNodeType, 1));
    this.tubeGeometry.setAttribute('aHealth', new THREE.BufferAttribute(this.tubeHealth, 1));
    this.tubeGeometry.setAttribute(
      'aMutationFlags',
      new THREE.BufferAttribute(this.tubeMutationFlags, 1),
    );
    this.tubeGeometry.setAttribute('aTubeU', new THREE.BufferAttribute(this.tubeTubeU, 1));
    this.tubeGeometry.setAttribute('aTubeV', new THREE.BufferAttribute(this.tubeTubeV, 1));
    this.tubeGeometry.setIndex(new THREE.BufferAttribute(this.tubeIndices, 1));
    this.tubeGeometry.setDrawRange(0, 0);

    this.tubeMesh = new THREE.Mesh(this.tubeGeometry, this.plantMaterial);
    this.tubeMesh.frustumCulled = false;
    this.scene.add(this.tubeMesh);

    this.leafGeometry = new THREE.BufferGeometry();
    const leafSize = this.config.leafSize;
    const leafRatio = this.config.leafLengthWidthRatio;
    const leafVertices = new Float32Array([
      -0.5 * leafSize,
      (-0.5 * leafSize) / leafRatio,
      0,
      0.5 * leafSize,
      (-0.5 * leafSize) / leafRatio,
      0,
      0.5 * leafSize,
      (0.5 * leafSize) / leafRatio,
      0,
      -0.5 * leafSize,
      (0.5 * leafSize) / leafRatio,
      0,
    ]);
    const leafNormals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const leafUvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const leafIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    this.leafGeometry.setAttribute('aPosition', new THREE.BufferAttribute(leafVertices, 3));
    this.leafGeometry.setAttribute('aNormal', new THREE.BufferAttribute(leafNormals, 3));
    this.leafGeometry.setAttribute('aUV', new THREE.BufferAttribute(leafUvs, 2));
    this.leafGeometry.setIndex(new THREE.BufferAttribute(leafIndices, 1));

    this.leafMesh = new THREE.InstancedMesh(this.leafGeometry, this.plantMaterial, this.maxLeaves);
    this.leafMesh.frustumCulled = false;
    this.leafMesh.instanceMatrix.usage = THREE.DynamicDrawUsage;
    this.scene.add(this.leafMesh);
  }

  private createFrame(tangent: THREE.Vector3): { normal: THREE.Vector3; binormal: THREE.Vector3 } {
    const up = new THREE.Vector3(0, 1, 0);
    let normal: THREE.Vector3;
    if (Math.abs(tangent.dot(up)) > 0.99) {
      normal = new THREE.Vector3(1, 0, 0);
    } else {
      normal = up.clone();
    }
    normal.sub(tangent.clone().multiplyScalar(tangent.dot(normal))).normalize();
    const binormal = tangent.clone().cross(normal);
    return { normal, binormal };
  }

  private addTubeSegment(parent: PlantNodeData, child: PlantNodeData): void {
    const startPos = parent.position;
    const endPos = child.position;
    const startRadius = 0.1;
    const endRadius = 0.1;

    const direction = new THREE.Vector3().subVectors(endPos, startPos);
    const length = direction.length();
    if (length < 0.001) return;

    const tangent = direction.clone().normalize();
    const { normal, binormal } = this.createFrame(tangent);

    const ringCount = this.config.tubeLengthSegments + 1;
    const segmentsAround = this.config.tubeRingCount;
    const capVertexCount = segmentsAround * 2;
    const baseVertex = this.tubeVertexCount;
    const baseIndex = this.tubeIndexCount;

    // Body rings between startPos and endPos
    for (let r = 0; r < ringCount; r++) {
      const t = r / (ringCount - 1);
      const pos = new THREE.Vector3().lerpVectors(startPos, endPos, t);
      const radius = startRadius + (endRadius - startRadius) * t;

      for (let s = 0; s < segmentsAround; s++) {
        const angle = (s / segmentsAround) * Math.PI * 2;
        const offset = normal
          .clone()
          .multiplyScalar(Math.cos(angle))
          .add(binormal.clone().multiplyScalar(Math.sin(angle)))
          .multiplyScalar(radius);
        const vertex = pos.clone().add(offset);
        const vi = baseVertex + r * segmentsAround + s;

        this.tubePositions[vi * 3] = vertex.x;
        this.tubePositions[vi * 3 + 1] = vertex.y;
        this.tubePositions[vi * 3 + 2] = vertex.z;

        const n = normal
          .clone()
          .multiplyScalar(Math.cos(angle))
          .add(binormal.clone().multiplyScalar(Math.sin(angle)));
        this.tubeNormals[vi * 3] = n.x;
        this.tubeNormals[vi * 3 + 1] = n.y;
        this.tubeNormals[vi * 3 + 2] = n.z;

        this.tubeBiomass[vi] = child.biomass;
        this.tubeNodeType[vi] = child.type;
        this.tubeHealth[vi] = child.health;
        this.tubeMutationFlags[vi] = child.mutationFlags;
        this.tubeTubeU[vi] = t;
        this.tubeTubeV[vi] = s / segmentsAround;
      }
    }

    // Start cap ring (at startPos, normals pointing along -tangent)
    const capStartBase = baseVertex + ringCount * segmentsAround;
    for (let s = 0; s < segmentsAround; s++) {
      const angle = (s / segmentsAround) * Math.PI * 2;
      const offset = normal
        .clone()
        .multiplyScalar(Math.cos(angle))
        .add(binormal.clone().multiplyScalar(Math.sin(angle)))
        .multiplyScalar(startRadius);
      const vertex = startPos.clone().add(offset);
      const vi = capStartBase + s;

      this.tubePositions[vi * 3] = vertex.x;
      this.tubePositions[vi * 3 + 1] = vertex.y;
      this.tubePositions[vi * 3 + 2] = vertex.z;

      this.tubeNormals[vi * 3] = -tangent.x;
      this.tubeNormals[vi * 3 + 1] = -tangent.y;
      this.tubeNormals[vi * 3 + 2] = -tangent.z;

      this.tubeBiomass[vi] = child.biomass;
      this.tubeNodeType[vi] = child.type;
      this.tubeHealth[vi] = child.health;
      this.tubeMutationFlags[vi] = child.mutationFlags;
      this.tubeTubeU[vi] = 0;
      this.tubeTubeV[vi] = s / segmentsAround;
    }

    // End cap ring (at endPos, normals pointing along +tangent)
    const capEndBase = capStartBase + segmentsAround;
    for (let s = 0; s < segmentsAround; s++) {
      const angle = (s / segmentsAround) * Math.PI * 2;
      const offset = normal
        .clone()
        .multiplyScalar(Math.cos(angle))
        .add(binormal.clone().multiplyScalar(Math.sin(angle)))
        .multiplyScalar(endRadius);
      const vertex = endPos.clone().add(offset);
      const vi = capEndBase + s;

      this.tubePositions[vi * 3] = vertex.x;
      this.tubePositions[vi * 3 + 1] = vertex.y;
      this.tubePositions[vi * 3 + 2] = vertex.z;

      this.tubeNormals[vi * 3] = tangent.x;
      this.tubeNormals[vi * 3 + 1] = tangent.y;
      this.tubeNormals[vi * 3 + 2] = tangent.z;

      this.tubeBiomass[vi] = child.biomass;
      this.tubeNodeType[vi] = child.type;
      this.tubeHealth[vi] = child.health;
      this.tubeMutationFlags[vi] = child.mutationFlags;
      this.tubeTubeU[vi] = 1;
      this.tubeTubeV[vi] = s / segmentsAround;
    }

    // Body ring indices
    for (let r = 0; r < ringCount - 1; r++) {
      for (let s = 0; s < segmentsAround; s++) {
        const sNext = (s + 1) % segmentsAround;
        const v0 = baseVertex + r * segmentsAround + s;
        const v1 = baseVertex + r * segmentsAround + sNext;
        const v2 = baseVertex + (r + 1) * segmentsAround + sNext;
        const v3 = baseVertex + (r + 1) * segmentsAround + s;

        this.tubeIndices[baseIndex + (r * segmentsAround + s) * 6] = v0;
        this.tubeIndices[baseIndex + (r * segmentsAround + s) * 6 + 1] = v1;
        this.tubeIndices[baseIndex + (r * segmentsAround + s) * 6 + 2] = v2;
        this.tubeIndices[baseIndex + (r * segmentsAround + s) * 6 + 3] = v0;
        this.tubeIndices[baseIndex + (r * segmentsAround + s) * 6 + 4] = v2;
        this.tubeIndices[baseIndex + (r * segmentsAround + s) * 6 + 5] = v3;
      }
    }

    // Start cap: connect capStartBase ring to body ring 0
    for (let s = 0; s < segmentsAround; s++) {
      const sNext = (s + 1) % segmentsAround;
      const c0 = capStartBase + s;
      const c1 = capStartBase + sNext;
      const b0 = baseVertex + s;
      const b1 = baseVertex + sNext;

      this.tubeIndices[baseIndex + (ringCount - 1) * segmentsAround * 6 + s * 6] = c0;
      this.tubeIndices[baseIndex + (ringCount - 1) * segmentsAround * 6 + s * 6 + 1] = c1;
      this.tubeIndices[baseIndex + (ringCount - 1) * segmentsAround * 6 + s * 6 + 2] = b1;
      this.tubeIndices[baseIndex + (ringCount - 1) * segmentsAround * 6 + s * 6 + 3] = c0;
      this.tubeIndices[baseIndex + (ringCount - 1) * segmentsAround * 6 + s * 6 + 4] = b1;
      this.tubeIndices[baseIndex + (ringCount - 1) * segmentsAround * 6 + s * 6 + 5] = b0;
    }

    // End cap: connect body last ring to capEndBase ring
    const lastBodyBase = baseVertex + (ringCount - 1) * segmentsAround;
    for (let s = 0; s < segmentsAround; s++) {
      const sNext = (s + 1) % segmentsAround;
      const b0 = lastBodyBase + s;
      const b1 = lastBodyBase + sNext;
      const c0 = capEndBase + s;
      const c1 = capEndBase + sNext;

      this.tubeIndices[
        baseIndex + (ringCount - 1) * segmentsAround * 6 + segmentsAround * 6 + s * 6
      ] = b0;
      this.tubeIndices[
        baseIndex + (ringCount - 1) * segmentsAround * 6 + segmentsAround * 6 + s * 6 + 1
      ] = b1;
      this.tubeIndices[
        baseIndex + (ringCount - 1) * segmentsAround * 6 + segmentsAround * 6 + s * 6 + 2
      ] = c1;
      this.tubeIndices[
        baseIndex + (ringCount - 1) * segmentsAround * 6 + segmentsAround * 6 + s * 6 + 3
      ] = b0;
      this.tubeIndices[
        baseIndex + (ringCount - 1) * segmentsAround * 6 + segmentsAround * 6 + s * 6 + 4
      ] = c1;
      this.tubeIndices[
        baseIndex + (ringCount - 1) * segmentsAround * 6 + segmentsAround * 6 + s * 6 + 5
      ] = c0;
    }

    this.tubeVertexCount += ringCount * segmentsAround + capVertexCount;
    this.tubeIndexCount +=
      (ringCount - 1) * segmentsAround * 6 + // body
      segmentsAround * 6 + // start cap
      segmentsAround * 6; // end cap

    this.nodeVertexOffset.set(child.id, baseVertex);
  }

  private addLeafInstances(node: PlantNodeData): void {
    const leafCount = this.config.leafCountPerNode;
    const baseInstance = this.leafInstanceCount;
    const rng = mulberry32(node.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0));

    for (let i = 0; i < leafCount; i++) {
      const ii = baseInstance + i;
      if (ii >= this.maxLeaves) break;

      const angle = rng() * Math.PI * 2;
      const elevation = rng() * Math.PI * 0.5;
      const dist = node.radius * (2.0 + rng() * 2.0);

      const pos = node.position.clone();
      pos.x += Math.cos(angle) * Math.cos(elevation) * dist;
      pos.y += Math.sin(elevation) * dist;
      pos.z += Math.sin(angle) * Math.cos(elevation) * dist;

      const leafNormal = new THREE.Vector3(
        Math.cos(angle) * Math.cos(elevation),
        Math.sin(elevation),
        Math.sin(angle) * Math.cos(elevation),
      ).normalize();

      const matrix = new THREE.Matrix4();
      matrix.makeRotationFromQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), leafNormal),
      );
      matrix.setPosition(pos);
      matrix.scale(new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + rng() * 0.4));

      const te = matrix.elements;
      for (let j = 0; j < 16; j++) {
        this.leafInstanceMatrix[ii * 16 + j] = te[j];
      }

      const healthFactor = clamp(node.health, 0, 1);
      const mutation2 = modFloat(node.mutationFlags / 4.0, 2.0);
      const r = 0.55 + healthFactor * 0.25 + mutation2 * this.config.mutation2Param * 0.2;
      const g = 0.7 + healthFactor * 0.2;
      const b = 0.2 + healthFactor * 0.1;
      this.leafInstanceColor[ii * 4] = r;
      this.leafInstanceColor[ii * 4 + 1] = g;
      this.leafInstanceColor[ii * 4 + 2] = b;
      this.leafInstanceColor[ii * 4 + 3] = 1.0;

      this.leafInstancePhase[ii] = rng();
    }

    this.leafInstanceCount += leafCount;
    this.nodeInstanceOffset.set(node.id, baseInstance);
  }

  updatePlantData(nodes: PlantNodeData[]): void {
    for (const node of nodes) {
      if (this.knownNodes.has(node.id)) continue;
      console.log('updatePlantData adding node:', {
        id: node.id,
        type: node.type,
        pos: [node.position.x, node.position.y, node.position.z],
        parentId: node.parentId,
        biomass: node.biomass,
      });
      this.knownNodes.set(node.id, node);

      if (node.parentId && this.knownNodes.has(node.parentId)) {
        const parent = this.knownNodes.get(node.parentId);
        if (parent) {
          console.log('updatePlantData adding tube:', {
            from: parent.id,
            to: node.id,
            fromPos: [parent.position.x, parent.position.y, parent.position.z],
            toPos: [node.position.x, node.position.y, node.position.z],
          });
          this.addTubeSegment(parent, node);
        }
      }

      if (node.type >= 3) {
        this.addLeafInstances(node);
      }
    }

    if (this.tubeVertexCount > 0) {
      (this.tubeGeometry.getAttribute('aPosition') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getAttribute('aNormal') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getAttribute('aBiomass') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getAttribute('aNodeType') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getAttribute('aHealth') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getAttribute('aMutationFlags') as THREE.BufferAttribute).needsUpdate =
        true;
      (this.tubeGeometry.getAttribute('aTubeU') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getAttribute('aTubeV') as THREE.BufferAttribute).needsUpdate = true;
      (this.tubeGeometry.getIndex() as THREE.BufferAttribute).needsUpdate = true;
      this.tubeGeometry.setDrawRange(0, this.tubeIndexCount);
      this.tubeGeometry.computeBoundingSphere();
      console.log('updatePlantData complete:', {
        tubeVertexCount: this.tubeVertexCount,
        tubeIndexCount: this.tubeIndexCount,
        leafInstanceCount: this.leafInstanceCount,
      });
    }

    if (this.leafInstanceCount > 0) {
      this.leafMesh.count = this.leafInstanceCount;
      const instanceMatrix = this.leafMesh.instanceMatrix;
      if (instanceMatrix) {
        instanceMatrix.set(this.leafInstanceMatrix);
        instanceMatrix.needsUpdate = true;
      }
      const instanceColor = this.leafMesh.instanceColor;
      if (instanceColor) {
        instanceColor.set(this.leafInstanceColor);
        instanceColor.needsUpdate = true;
      }
    }
  }

  generateTestPlant(seed: number = 12345): PlantNodeData[] {
    const nodes: PlantNodeData[] = [];
    const rng = mulberry32(seed);
    const maxNodes = this.config.maxNodesPerPlant;

    const rootId = 'root_0';
    nodes.push({
      id: rootId,
      position: new THREE.Vector3(0, 0, 0),
      type: 0,
      radius: 0.4,
      parentId: null,
      age: 10,
      health: 0.9,
      mutationFlags: 0,
      biomass: 1.0,
    });

    const rootCount = Math.floor(maxNodes * 0.5);
    for (let i = 0; i < rootCount; i++) {
      const depth = rng() * 30 + 2;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 15;
      const id = `root_${i + 1}`;
      const parentId = i % 5 === 0 ? rootId : `root_${Math.floor(i / 2)}`;
      const mutation = rng() < 0.1 ? 1 : rng() < 0.1 ? 2 : 0;

      nodes.push({
        id,
        position: new THREE.Vector3(Math.cos(angle) * radius, -depth, Math.sin(angle) * radius),
        type: 0,
        radius: 0.15 + rng() * 0.2,
        parentId,
        age: rng() * 5,
        health: 0.6 + rng() * 0.4,
        mutationFlags: mutation,
        biomass: 0.3 + rng() * 0.7,
      });
    }

    const stemId = 'stem_0';
    nodes.push({
      id: stemId,
      position: new THREE.Vector3(0, 0, 0),
      type: 1,
      radius: 0.3,
      parentId: rootId,
      age: 10,
      health: 0.85,
      mutationFlags: 0,
      biomass: 1.0,
    });

    const stemCount = Math.floor(maxNodes * 0.3);
    for (let i = 0; i < stemCount; i++) {
      const height = rng() * 25 + 2;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 8;
      const id = `stem_${i + 1}`;
      const parentId = i % 4 === 0 ? stemId : `stem_${Math.floor(i / 2)}`;
      const mutation = rng() < 0.1 ? 4 : 0;

      nodes.push({
        id,
        position: new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius),
        type: 1,
        radius: 0.12 + rng() * 0.15,
        parentId,
        age: rng() * 5,
        health: 0.7 + rng() * 0.3,
        mutationFlags: mutation,
        biomass: 0.4 + rng() * 0.6,
      });
    }

    const vineCount = Math.floor(maxNodes * 0.15);
    for (let i = 0; i < vineCount; i++) {
      const height = rng() * 20 + 1;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 12;
      const id = `vine_${i}`;
      const parentId = i % 3 === 0 ? stemId : `vine_${Math.max(0, i - 1)}`;

      nodes.push({
        id,
        position: new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius),
        type: 2,
        radius: 0.08 + rng() * 0.1,
        parentId,
        age: rng() * 4,
        health: 0.65 + rng() * 0.3,
        mutationFlags: 0,
        biomass: 0.35 + rng() * 0.5,
      });
    }

    const leafCount = maxNodes - nodes.length;
    for (let i = 0; i < leafCount; i++) {
      const height = rng() * 25 + 2;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 8;
      const id = `leaf_${i}`;
      const parentId = stemId;

      nodes.push({
        id,
        position: new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius),
        type: 3,
        radius: 0.05,
        parentId,
        age: rng() * 3,
        health: 0.75 + rng() * 0.25,
        mutationFlags: rng() < 0.15 ? 4 : 0,
        biomass: 0.5 + rng() * 0.5,
      });
    }

    return nodes;
  }

  setLODLevel(cameraPosition: THREE.Vector3): void {
    const box = this.tubeGeometry.boundingSphere;
    if (!box) return;

    const center = box.center.clone().applyMatrix4(this.tubeMesh.matrixWorld);
    const distance = cameraPosition.distanceTo(center);

    let lodLevel = 0;
    if (distance >= this.config.l2Distance) {
      lodLevel = 2;
    } else if (distance >= this.config.l1Distance) {
      lodLevel = 1;
    }

    this.plantMaterial.uniforms.uLODLevel.value = lodLevel;

    if (this.leafMesh) {
      this.leafMesh.visible = lodLevel === 0;
    }
  }

  update(_deltaTime: number): void {
    const elapsed = (Date.now() - this.startTime) / 1000;

    this.plantMaterial.uniforms.uTime.value = elapsed;
    this.plantMaterial.uniforms.uCameraPosition.value.copy(this.camera.position);
    this.plantMaterial.uniforms.uWindStrength.value = this.config.windStrength;
    this.plantMaterial.uniforms.uWindSpeed.value = this.config.windSpeed;
    this.plantMaterial.uniforms.uHealthTintStrength.value = this.config.healthTintStrength;
    this.plantMaterial.uniforms.uMutation0Param.value = this.config.mutation0Param;
    this.plantMaterial.uniforms.uMutation1Param.value = this.config.mutation1Param;
    this.plantMaterial.uniforms.uMutation2Param.value = this.config.mutation2Param;
    this.plantMaterial.uniforms.modelMatrix.value.copy(this.tubeMesh.matrixWorld);

    if (this.camera) {
      this.setLODLevel(this.camera.position);
    }
  }

  setConfig(config: Partial<PlantRendererConfig>): void {
    this.config = { ...this.config, ...config };

    this.plantMaterial.uniforms.uWindStrength.value = this.config.windStrength;
    this.plantMaterial.uniforms.uWindSpeed.value = this.config.windSpeed;
    this.plantMaterial.uniforms.uHealthTintStrength.value = this.config.healthTintStrength;
    this.plantMaterial.uniforms.uMutation0Param.value = this.config.mutation0Param;
    this.plantMaterial.uniforms.uMutation1Param.value = this.config.mutation1Param;
    this.plantMaterial.uniforms.uMutation2Param.value = this.config.mutation2Param;
  }

  getConfig(): PlantRendererConfig {
    return { ...this.config };
  }

  rebuild(): void {
    this.tubeVertexCount = 0;
    this.tubeIndexCount = 0;
    this.leafInstanceCount = 0;
    this.nodeVertexOffset.clear();
    this.nodeInstanceOffset.clear();
    this.knownNodes.clear();
    this.tubeGeometry.setDrawRange(0, 0);
    this.leafMesh.count = 0;
  }

  dispose(): void {
    this.tubeGeometry.dispose();
    this.leafGeometry.dispose();
    this.plantMaterial.dispose();
    this.scene.remove(this.tubeMesh);
    this.scene.remove(this.leafMesh);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function modFloat(a: number, b: number): number {
  return ((a % b) + b) % b;
}

export default PlantRenderer;
