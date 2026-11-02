/**
 * Plant Renderer - GPU-accelerated procedural plant rendering
 * Uses Root Sight shaders for underground/above-ground visualization
 */

import * as THREE from 'three';

// Shader sources inlined for Vite compatibility.
// Three.js prepends `#version 300 es`, the precision block and the built-in
// matrices/attributes, so none of those may be declared here.
const plantNodeVert = `layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aBiomass;
layout(location = 3) in float aNodeType;
layout(location = 4) in float aWaterLevel;
layout(location = 5) in float aNutrientLevel;
layout(location = 6) in float aPhotosynthesisRate;

uniform float uTime;
uniform float uNodeSize;
uniform float uRootSightOpacity;
uniform bool uRootSightEnabled;
uniform bool uCanopySightEnabled;
uniform bool uPhotosynthesisViz;
uniform bool uWaterFlowViz;
uniform bool uNutrientFlowViz;

out vec3 vPosition;
out vec3 vNormal;
out float vBiomass;
out float vNodeType;
out float vWaterLevel;
out float vNutrientLevel;
out float vPhotosynthesisRate;
out float vDepth;
out vec3 vWorldPos;

void main() {
    vWorldPos = (modelMatrix * vec4(aPosition, 1.0)).xyz;
    vPosition = aPosition;
    vNormal = normalize(mat3(modelMatrix) * aNormal);
    vBiomass = aBiomass;
    vNodeType = aNodeType;
    vWaterLevel = aWaterLevel;
    vNutrientLevel = aNutrientLevel;
    vPhotosynthesisRate = aPhotosynthesisRate;
    vDepth = vWorldPos.y;

    vec4 mvPosition = modelViewMatrix * vec4(aPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float size = uNodeSize * (1.0 + aBiomass * 2.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
}
`;

const plantNodeFrag = `in vec3 vPosition;
in vec3 vNormal;
in float vBiomass;
in float vNodeType;
in float vWaterLevel;
in float vNutrientLevel;
in float vPhotosynthesisRate;
in float vDepth;
in vec3 vWorldPos;

uniform float uTime;
uniform float uRootSightOpacity;
uniform bool uRootSightEnabled;
uniform bool uCanopySightEnabled;
uniform bool uPhotosynthesisViz;
uniform bool uWaterFlowViz;
uniform bool uNutrientFlowViz;
uniform vec3 uSunDirection;
uniform vec3 uGroundColor;
uniform vec3 uRootColor;
uniform vec3 uCanopyColor;

out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    float isRoot = step(0.5, vNodeType);
    float isCanopy = 1.0 - isRoot;
    
    vec3 baseColor;
    float alpha = 1.0;
    
    if (isRoot > 0.5) {
        if (!uRootSightEnabled) {
            discard;
        }
        
        baseColor = uRootColor;
        
        if (uWaterFlowViz) {
            float waterPulse = sin(uTime * 3.0 + vWorldPos.y * 10.0) * 0.5 + 0.5;
            float waterIntensity = vWaterLevel * waterPulse * 0.5;
            baseColor = mix(baseColor, vec3(0.2, 0.5, 1.0), waterIntensity);
        }
        
        if (uNutrientFlowViz) {
            float nutrientPulse = sin(uTime * 2.0 + vWorldPos.z * 8.0) * 0.5 + 0.5;
            float nutrientIntensity = vNutrientLevel * nutrientPulse * 0.4;
            baseColor = mix(baseColor, vec3(0.8, 0.9, 0.2), nutrientIntensity);
        }
        
        float depthFactor = clamp(1.0 + vDepth / 50.0, 0.1, 1.0);
        alpha = uRootSightOpacity * depthFactor * (0.5 + vBiomass * 0.5);
        
        float lifePulse = sin(uTime * 1.5 + vWorldPos.x * 5.0) * 0.05 + 0.95;
        alpha *= lifePulse;
        
    } else {
        if (!uCanopySightEnabled) {
            discard;
        }
        
        baseColor = uCanopyColor;
        
        if (uPhotosynthesisViz) {
            float photoPulse = sin(uTime * 2.5 + vWorldPos.x * 3.0) * 0.5 + 0.5;
            float photoIntensity = vPhotosynthesisRate * photoPulse * 0.6;
            baseColor = mix(baseColor, vec3(0.9, 1.0, 0.3), photoIntensity);
        }
        
        float NdotL = max(dot(vNormal, uSunDirection), 0.0);
        baseColor *= 0.3 + 0.7 * NdotL;
        
        float season = sin(uTime * 0.1) * 0.1;
        baseColor.r += season;
        baseColor.g += season * 0.5;
        
        alpha = 1.0;
    }
    
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    float edge = 1.0 - smoothstep(0.4, 0.5, dist);
    alpha *= edge;
    
    baseColor *= 0.5 + vBiomass * 0.5;
    
    fragColor = vec4(baseColor, alpha);
}
`;

const groundVert = `// position and uv come from PlaneGeometry via Three's preamble.
uniform float uTime;

out vec2 vUv;
out vec3 vWorldPos;
out float vDepth;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vDepth = worldPos.y;
    vUv = uv;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const groundFrag = `in vec2 vUv;
in vec3 vWorldPos;
in float vDepth;

uniform float uTime;
uniform float uWaterTableDepth;
uniform bool uShowSoilLayers;
uniform bool uShowWaterTable;
uniform bool uShowRootZone;
uniform vec3 uSurfaceColor;
uniform vec3 uTopsoilColor;
uniform vec3 uSubsoilColor;
uniform vec3 uBedrockColor;
uniform vec3 uWaterColor;

out vec4 fragColor;

float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        value += amplitude * noise(p * frequency);
        frequency *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    float depth = -vDepth;
    
    vec3 color = uSurfaceColor;
    
    if (uShowSoilLayers) {
        if (depth > 0.0) {
            if (depth < 2.0) {
                float blend = depth / 2.0;
                color = mix(uSurfaceColor, uTopsoilColor, blend);
                color += vec3(fbm(vUv * 10.0 + vWorldPos.xz * 0.5, 4) * 0.05);
            } else if (depth < 10.0) {
                float blend = (depth - 2.0) / 8.0;
                color = mix(uTopsoilColor, uSubsoilColor, blend);
                color += vec3(fbm(vUv * 5.0 + vWorldPos.xz * 0.3, 3) * 0.03);
            } else {
                color = uBedrockColor;
                float cracks = fbm(vUv * 20.0 + vWorldPos.xz * 0.1, 2);
                color *= 1.0 - cracks * 0.1;
            }
        }
    }
    
    if (uShowWaterTable) {
        float waterDist = abs(depth - uWaterTableDepth);
        if (waterDist < 0.5) {
            float waterAlpha = 1.0 - waterDist / 0.5;
            color = mix(color, uWaterColor, waterAlpha * 0.6);
            float shimmer = sin(vWorldPos.x * 50.0 + uTime * 2.0) * 
                           sin(vWorldPos.z * 50.0 + uTime * 1.5) * 0.1 + 0.9;
            color *= shimmer;
        }
    }
    
    if (uShowRootZone && depth > 0.0 && depth < 5.0) {
        float rootZoneAlpha = 1.0 - depth / 5.0;
        color = mix(color, vec3(0.4, 0.5, 0.3), rootZoneAlpha * 0.2);
    }
    
    if (vDepth >= 0.0) {
        float texture = fbm(vUv * 50.0, 3) * 0.02;
        color += vec3(texture);
    }
    
    float fogFactor = 1.0 - exp(-abs(vDepth) * 0.01);
    vec3 fogColor = vec3(0.15, 0.18, 0.12);
    color = mix(color, fogColor, fogFactor * 0.3);
    
    fragColor = vec4(color, 1.0);
}
`;

interface PlantNodeData {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  biomass: number;
  nodeType: number;
  waterLevel: number;
  nutrientLevel: number;
  photosynthesisRate: number;
}

interface PlantRendererConfig {
  maxNodesPerPlant: number;
  rootSightEnabled: boolean;
  rootSightOpacity: number;
  canopySightEnabled: boolean;
  photosynthesisViz: boolean;
  waterFlowViz: boolean;
  nutrientFlowViz: boolean;
  nodeSize: number;
}

export class PlantRenderer {
  private scene: THREE.Scene;

  private plantMaterial!: THREE.ShaderMaterial;
  private plantGeometry!: THREE.BufferGeometry;
  private plantPoints!: THREE.Points;

  private groundMaterial!: THREE.ShaderMaterial;
  private groundMesh!: THREE.Mesh;

  private positionBuffer!: THREE.BufferAttribute;
  private normalBuffer!: THREE.BufferAttribute;
  private biomassBuffer!: THREE.BufferAttribute;
  private nodeTypeBuffer!: THREE.BufferAttribute;
  private waterLevelBuffer!: THREE.BufferAttribute;
  private nutrientLevelBuffer!: THREE.BufferAttribute;
  private photosynthesisBuffer!: THREE.BufferAttribute;

  private maxNodes: number;
  private currentNodeCount: number = 0;
  private config: PlantRendererConfig;

  private startTime: number = Date.now();

  constructor(
    _renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    _camera: THREE.Camera,
    config: Partial<PlantRendererConfig> = {},
  ) {
    this.scene = scene;

    this.config = {
      maxNodesPerPlant: config.maxNodesPerPlant ?? 1000,
      rootSightEnabled: config.rootSightEnabled ?? true,
      rootSightOpacity: config.rootSightOpacity ?? 0.6,
      canopySightEnabled: config.canopySightEnabled ?? true,
      photosynthesisViz: config.photosynthesisViz ?? true,
      waterFlowViz: config.waterFlowViz ?? true,
      nutrientFlowViz: config.nutrientFlowViz ?? true,
      nodeSize: config.nodeSize ?? 1.0,
    };

    this.maxNodes = this.config.maxNodesPerPlant;

    this.initShaders();
    this.initGeometry();
    this.initGround();
  }

  private initShaders(): void {
    this.plantMaterial = new THREE.ShaderMaterial({
      vertexShader: plantNodeVert,
      fragmentShader: plantNodeFrag,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uNodeSize: { value: this.config.nodeSize },
        uRootSightOpacity: { value: this.config.rootSightOpacity },
        uRootSightEnabled: { value: this.config.rootSightEnabled },
        uCanopySightEnabled: { value: this.config.canopySightEnabled },
        uPhotosynthesisViz: { value: this.config.photosynthesisViz },
        uWaterFlowViz: { value: this.config.waterFlowViz },
        uNutrientFlowViz: { value: this.config.nutrientFlowViz },
        uSunDirection: { value: new THREE.Vector3(0.5, 1.0, 0.5).normalize() },
        uGroundColor: { value: new THREE.Color(0x2a281f) },
        uRootColor: { value: new THREE.Color(0x5d4037) },
        uCanopyColor: { value: new THREE.Color(0x4caf50) },
        modelMatrix: { value: new THREE.Matrix4() },
      },
    });

    this.groundMaterial = new THREE.ShaderMaterial({
      vertexShader: groundVert,
      fragmentShader: groundFrag,
      glslVersion: THREE.GLSL3,
      transparent: false,
      depthTest: true,
      depthWrite: true,
      uniforms: {
        uTime: { value: 0 },
        uWaterTableDepth: { value: -5.0 },
        uShowSoilLayers: { value: true },
        uShowWaterTable: { value: true },
        uShowRootZone: { value: true },
        uSurfaceColor: { value: new THREE.Color(0x2a281f) },
        uTopsoilColor: { value: new THREE.Color(0x3d2f1f) },
        uSubsoilColor: { value: new THREE.Color(0x4a3728) },
        uBedrockColor: { value: new THREE.Color(0x2d2d2d) },
        uWaterColor: { value: new THREE.Color(0x1a3a5c) },
        modelMatrix: { value: new THREE.Matrix4() },
      },
    });
  }

  private initGeometry(): void {
    this.plantGeometry = new THREE.BufferGeometry();

    const maxNodes = this.maxNodes;

    const positions = new Float32Array(maxNodes * 3);
    const normals = new Float32Array(maxNodes * 3);
    const biomass = new Float32Array(maxNodes);
    const nodeTypes = new Float32Array(maxNodes);
    const waterLevels = new Float32Array(maxNodes);
    const nutrientLevels = new Float32Array(maxNodes);
    const photosynthesis = new Float32Array(maxNodes);

    this.positionBuffer = new THREE.BufferAttribute(positions, 3);
    this.normalBuffer = new THREE.BufferAttribute(normals, 3);
    this.biomassBuffer = new THREE.BufferAttribute(biomass, 1);
    this.nodeTypeBuffer = new THREE.BufferAttribute(nodeTypes, 1);
    this.waterLevelBuffer = new THREE.BufferAttribute(waterLevels, 1);
    this.nutrientLevelBuffer = new THREE.BufferAttribute(nutrientLevels, 1);
    this.photosynthesisBuffer = new THREE.BufferAttribute(photosynthesis, 1);

    this.plantGeometry.setAttribute('aPosition', this.positionBuffer);
    this.plantGeometry.setAttribute('aNormal', this.normalBuffer);
    this.plantGeometry.setAttribute('aBiomass', this.biomassBuffer);
    this.plantGeometry.setAttribute('aNodeType', this.nodeTypeBuffer);
    this.plantGeometry.setAttribute('aWaterLevel', this.waterLevelBuffer);
    this.plantGeometry.setAttribute('aNutrientLevel', this.nutrientLevelBuffer);
    this.plantGeometry.setAttribute('aPhotosynthesisRate', this.photosynthesisBuffer);

    this.plantGeometry.setDrawRange(0, 0);

    this.plantPoints = new THREE.Points(this.plantGeometry, this.plantMaterial);
    this.plantPoints.frustumCulled = false;
    this.scene.add(this.plantPoints);
  }

  private initGround(): void {
    const groundGeometry = new THREE.PlaneGeometry(2000, 2000, 200, 200);
    groundGeometry.rotateX(-Math.PI / 2);

    this.groundMesh = new THREE.Mesh(groundGeometry, this.groundMaterial);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }

  updatePlantData(nodes: PlantNodeData[]): void {
    this.currentNodeCount = Math.min(nodes.length, this.maxNodes);

    for (let i = 0; i < this.currentNodeCount; i++) {
      const node = nodes[i];
      const i3 = i * 3;

      this.positionBuffer.array[i3] = node.position.x;
      this.positionBuffer.array[i3 + 1] = node.position.y;
      this.positionBuffer.array[i3 + 2] = node.position.z;

      this.normalBuffer.array[i3] = node.normal.x;
      this.normalBuffer.array[i3 + 1] = node.normal.y;
      this.normalBuffer.array[i3 + 2] = node.normal.z;

      this.biomassBuffer.array[i] = node.biomass;
      this.nodeTypeBuffer.array[i] = node.nodeType;
      this.waterLevelBuffer.array[i] = node.waterLevel;
      this.nutrientLevelBuffer.array[i] = node.nutrientLevel;
      this.photosynthesisBuffer.array[i] = node.photosynthesisRate;
    }

    this.positionBuffer.needsUpdate = true;
    this.normalBuffer.needsUpdate = true;
    this.biomassBuffer.needsUpdate = true;
    this.nodeTypeBuffer.needsUpdate = true;
    this.waterLevelBuffer.needsUpdate = true;
    this.nutrientLevelBuffer.needsUpdate = true;
    this.photosynthesisBuffer.needsUpdate = true;

    this.plantGeometry.setDrawRange(0, this.currentNodeCount);
  }

  generateTestPlant(seed: number = 12345): PlantNodeData[] {
    const nodes: PlantNodeData[] = [];
    const rng = this.mulberry32(seed);

    const rootCount = Math.floor(this.maxNodes * 0.6);
    for (let i = 0; i < rootCount; i++) {
      const depth = rng() * 40 + 2;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 15;

      nodes.push({
        position: new THREE.Vector3(Math.cos(angle) * radius, -depth, Math.sin(angle) * radius),
        normal: new THREE.Vector3((rng() - 0.5) * 0.2, 1.0, (rng() - 0.5) * 0.2).normalize(),
        biomass: 0.3 + rng() * 0.7,
        nodeType: 0,
        waterLevel: 0.5 + rng() * 0.5,
        nutrientLevel: 0.3 + rng() * 0.7,
        photosynthesisRate: 0.0,
      });
    }

    const canopyCount = Math.floor(this.maxNodes * 0.4);
    for (let i = 0; i < canopyCount; i++) {
      const height = rng() * 30 + 2;
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 10;

      nodes.push({
        position: new THREE.Vector3(Math.cos(angle) * radius, height, Math.sin(angle) * radius),
        normal: new THREE.Vector3(
          (rng() - 0.5) * 0.3,
          0.8 + rng() * 0.2,
          (rng() - 0.5) * 0.3,
        ).normalize(),
        biomass: 0.4 + rng() * 0.6,
        nodeType: 1,
        waterLevel: 0.6 + rng() * 0.4,
        nutrientLevel: 0.4 + rng() * 0.6,
        photosynthesisRate: 0.5 + rng() * 0.5,
      });
    }

    return nodes;
  }

  private mulberry32(a: number): () => number {
    return () => {
      a += 0x6d2b79f5;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  update(_deltaTime: number): void {
    const elapsed = (Date.now() - this.startTime) / 1000;

    this.plantMaterial.uniforms.uTime.value = elapsed;
    this.groundMaterial.uniforms.uTime.value = elapsed;

    this.plantMaterial.uniforms.modelMatrix.value.copy(this.plantPoints.matrixWorld);
    this.groundMaterial.uniforms.modelMatrix.value.copy(this.groundMesh.matrixWorld);
  }

  setConfig(config: Partial<PlantRendererConfig>): void {
    this.config = { ...this.config, ...config };

    this.plantMaterial.uniforms.uRootSightEnabled.value = this.config.rootSightEnabled;
    this.plantMaterial.uniforms.uRootSightOpacity.value = this.config.rootSightOpacity;
    this.plantMaterial.uniforms.uCanopySightEnabled.value = this.config.canopySightEnabled;
    this.plantMaterial.uniforms.uPhotosynthesisViz.value = this.config.photosynthesisViz;
    this.plantMaterial.uniforms.uWaterFlowViz.value = this.config.waterFlowViz;
    this.plantMaterial.uniforms.uNutrientFlowViz.value = this.config.nutrientFlowViz;
    this.plantMaterial.uniforms.uNodeSize.value = this.config.nodeSize;
  }

  getConfig(): PlantRendererConfig {
    return { ...this.config };
  }

  dispose(): void {
    this.plantGeometry.dispose();
    this.plantMaterial.dispose();
    this.groundMaterial.dispose();
    this.groundMesh.geometry.dispose();
    this.scene.remove(this.plantPoints);
    this.scene.remove(this.groundMesh);
  }
}

export default PlantRenderer;
