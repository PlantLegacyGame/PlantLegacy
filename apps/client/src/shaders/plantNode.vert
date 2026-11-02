// Plant Node Vertex Shader
// Renders plant nodes (roots and canopy) as points with size based on biomass

#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in float aBiomass;
layout(location = 3) in float aNodeType; // 0 = root, 1 = canopy
layout(location = 4) in float aWaterLevel;
layout(location = 5) in float aNutrientLevel;
layout(location = 6) in float aPhotosynthesisRate;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
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
    vNormal = normalize((modelViewMatrix * vec4(aNormal, 0.0)).xyz);
    vBiomass = aBiomass;
    vNodeType = aNodeType;
    vWaterLevel = aWaterLevel;
    vNutrientLevel = aNutrientLevel;
    vPhotosynthesisRate = aPhotosynthesisRate;
    vDepth = vWorldPos.y; // Y is up, so negative = underground

    vec4 mvPosition = modelViewMatrix * vec4(aPosition, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Point size based on biomass and distance
    float size = uNodeSize * (1.0 + aBiomass * 2.0);
    gl_PointSize = size * (300.0 / -mvPosition.z);
}