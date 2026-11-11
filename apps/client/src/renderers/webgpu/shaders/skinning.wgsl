// C02b: GPU skinning helpers.
// Included only by shaders whose bind group provides the joint matrix buffer
// at @group(0) @binding(2).

@group(0) @binding(2) var<storage, read> jointMatrices: array<mat4x4f>;

struct SkinnedVertex {
  position: vec3f,
  normal: vec3f,
}

fn skinVertexWithNormal(
  position: vec3f,
  normal: vec3f,
  jointIndices: vec4<u32>,
  jointWeights: vec4<f32>,
  plantIndex: u32,
) -> SkinnedVertex {
  let baseJointOffset = plantIndex * 64u; // MAX_JOINTS_PER_PLANT = 64
  var skinnedPos = vec3f(0.0, 0.0, 0.0);
  var skinnedNormal = vec3f(0.0, 0.0, 0.0);

  for (var i = 0u; i < 4u; i = i + 1u) {
    let weight = jointWeights[i];
    if (weight > 0.0) {
      let jointIdx = jointIndices[i] + baseJointOffset;
      let jointMatrix = jointMatrices[jointIdx];
      skinnedPos += weight * (jointMatrix * vec4f(position, 1.0)).xyz;
      skinnedNormal += weight * (jointMatrix * vec4f(normal, 0.0)).xyz;
    }
  }

  return SkinnedVertex(skinnedPos, normalize(skinnedNormal));
}
