// Ground/Terrain Fragment Shader
// Shows soil layers, water table, root zone, etc.

#version 300 es
precision highp float;

in vec2 vUv;
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
    float depth = -vDepth; // Positive = underground
    
    vec3 color = uSurfaceColor;
    
    // Soil layers
    if (uShowSoilLayers) {
        if (depth > 0.0) {
            // Underground - show soil layers
            if (depth < 2.0) {
                // Topsoil
                float blend = depth / 2.0;
                color = mix(uSurfaceColor, uTopsoilColor, blend);
                // Add organic matter noise
                color += vec3(fbm(vUv * 10.0 + vWorldPos.xz * 0.5, 4) * 0.05);
            } else if (depth < 10.0) {
                // Subsoil
                float blend = (depth - 2.0) / 8.0;
                color = mix(uTopsoilColor, uSubsoilColor, blend);
                // Mineral deposits
                color += vec3(fbm(vUv * 5.0 + vWorldPos.xz * 0.3, 3) * 0.03);
            } else {
                // Bedrock
                color = uBedrockColor;
                // Cracks and fissures
                float cracks = fbm(vUv * 20.0 + vWorldPos.xz * 0.1, 2);
                color *= 1.0 - cracks * 0.1;
            }
        }
    }
    
    // Water table
    if (uShowWaterTable) {
        float waterDist = abs(depth - uWaterTableDepth);
        if (waterDist < 0.5) {
            float waterAlpha = 1.0 - waterDist / 0.5;
            color = mix(color, uWaterColor, waterAlpha * 0.6);
            // Water shimmer
            float shimmer = sin(vWorldPos.x * 50.0 + uTime * 2.0) * 
                           sin(vWorldPos.z * 50.0 + uTime * 1.5) * 0.1 + 0.9;
            color *= shimmer;
        }
    }
    
    // Root zone indicator
    if (uShowRootZone && depth > 0.0 && depth < 5.0) {
        float rootZoneAlpha = 1.0 - depth / 5.0;
        color = mix(color, vec3(0.4, 0.5, 0.3), rootZoneAlpha * 0.2);
    }
    
    // Subtle surface texture
    if (vDepth >= 0.0) {
        float texture = fbm(vUv * 50.0, 3) * 0.02;
        color += vec3(texture);
    }
    
    // Fog for depth perception
    float fogFactor = 1.0 - exp(-abs(vDepth) * 0.01);
    vec3 fogColor = vec3(0.15, 0.18, 0.12);
    color = mix(color, fogColor, fogFactor * 0.3);
    
    fragColor = vec4(color, 1.0);
}