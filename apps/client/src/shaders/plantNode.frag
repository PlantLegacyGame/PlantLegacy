// Plant Node Fragment Shader
// Root Sight: shows roots underground with water/nutrient flow
// Canopy: shows photosynthesis activity

#version 300 es
precision highp float;

in vec3 vPosition;
in vec3 vNormal;
in float vBiomass;
in float vNodeType; // 0 = root, 1 = canopy
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

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

void main() {
    float isRoot = step(0.5, vNodeType);
    float isCanopy = 1.0 - isRoot;
    
    vec3 baseColor;
    float alpha = 1.0;
    
    if (isRoot > 0.5) {
        // ROOT: Underground visualization
        if (!uRootSightEnabled) {
            discard;
        }
        
        // Base root color (brown/earth tones)
        baseColor = uRootColor;
        
        // Water flow visualization (blue pulse)
        if (uWaterFlowViz) {
            float waterPulse = sin(uTime * 3.0 + vWorldPos.y * 10.0) * 0.5 + 0.5;
            float waterIntensity = vWaterLevel * waterPulse * 0.5;
            baseColor = mix(baseColor, vec3(0.2, 0.5, 1.0), waterIntensity);
        }
        
        // Nutrient flow visualization (green/gold pulse)
        if (uNutrientFlowViz) {
            float nutrientPulse = sin(uTime * 2.0 + vWorldPos.z * 8.0) * 0.5 + 0.5;
            float nutrientIntensity = vNutrientLevel * nutrientPulse * 0.4;
            baseColor = mix(baseColor, vec3(0.8, 0.9, 0.2), nutrientIntensity);
        }
        
        // Depth-based opacity (deeper = more transparent for Root Sight)
        float depthFactor = clamp(1.0 + vDepth / 50.0, 0.1, 1.0);
        alpha = uRootSightOpacity * depthFactor * (0.5 + vBiomass * 0.5);
        
        // Add subtle pulse for living roots
        float lifePulse = sin(uTime * 1.5 + vWorldPos.x * 5.0) * 0.05 + 0.95;
        alpha *= lifePulse;
        
    } else {
        // CANOPY: Above ground visualization
        if (!uCanopySightEnabled) {
            discard;
        }
        
        // Base canopy color (green)
        baseColor = uCanopyColor;
        
        // Photosynthesis visualization (bright green/yellow pulse)
        if (uPhotosynthesisViz) {
            float photoPulse = sin(uTime * 2.5 + vWorldPos.x * 3.0) * 0.5 + 0.5;
            float photoIntensity = vPhotosynthesisRate * photoPulse * 0.6;
            baseColor = mix(baseColor, vec3(0.9, 1.0, 0.3), photoIntensity);
        }
        
        // Lighting based on sun direction
        float NdotL = max(dot(vNormal, uSunDirection), 0.0);
        baseColor *= 0.3 + 0.7 * NdotL;
        
        // Seasonal color variation
        float season = sin(uTime * 0.1) * 0.1;
        baseColor.r += season;
        baseColor.g += season * 0.5;
        
        alpha = 1.0;
    }
    
    // Circular point sprite
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) discard;
    
    // Soft edge
    float edge = 1.0 - smoothstep(0.4, 0.5, dist);
    alpha *= edge;
    
    // Biomass affects size/brightness
    baseColor *= 0.5 + vBiomass * 0.5;
    
    fragColor = vec4(baseColor, alpha);
}