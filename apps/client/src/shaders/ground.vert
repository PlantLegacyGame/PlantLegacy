// Ground/Terrain Vertex Shader
// Renders ground plane with underground/above-ground split

#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aUv;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform float uTime;

out vec2 vUv;
out vec3 vWorldPos;
out float vDepth;

void main() {
    vec4 worldPos = modelMatrix * vec4(aPosition, 1.0);
    vWorldPos = worldPos.xyz;
    vDepth = worldPos.y;
    vUv = aUv;
    
    vec4 mvPosition = modelViewMatrix * worldPos;
    gl_Position = projectionMatrix * mvPosition;
}