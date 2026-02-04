import * as THREE from 'three'

/**
 * Custom block shader that replaces MeshLambertMaterial.
 *
 * This shader:
 * - Matches MeshLambertMaterial appearance (ambient + directional lighting)
 * - Uses vertex colors (which contain baked AO, smooth lighting, directional shading)
 * - Supports texture atlas with alpha testing
 * - Provides foundation for future enhancements (per-pixel lighting, etc.)
 */

const vertexShader = /* glsl */ `
  attribute vec3 color;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv;
    vColor = color;

    // Transform normal to view space for lighting
    vNormal = normalize(normalMatrix * normal);

    // Calculate view-space position for lighting
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;

    gl_Position = projectionMatrix * mvPosition;
  }
`

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D map;
  uniform float alphaTest;

  // Lighting uniforms
  uniform vec3 ambientLightColor;
  uniform float ambientLightIntensity;
  uniform vec3 directionalLightDir;
  uniform vec3 directionalLightColor;
  uniform float directionalLightIntensity;

  // Fog uniforms (optional)
  uniform bool useFog;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // Sample texture
    vec4 texColor = texture2D(map, vUv);

    // Alpha test - discard transparent pixels
    if (texColor.a < alphaTest) discard;

    // Base color = texture * vertex color (vertex color has baked lighting/tint)
    vec3 baseColor = texColor.rgb * vColor;

    // Ambient lighting
    vec3 ambient = ambientLightColor * ambientLightIntensity;

    // Directional lighting (Lambertian)
    vec3 normal = normalize(vNormal);
    float NdotL = max(dot(normal, directionalLightDir), 0.0);
    vec3 directional = directionalLightColor * directionalLightIntensity * NdotL;

    // Combine lighting with base color
    // The multiplication approach matches MeshLambertMaterial behavior
    vec3 finalColor = baseColor * (ambient + directional);

    // Apply fog if enabled
    if (useFog) {
      float depth = length(vViewPosition);
      float fogFactor = smoothstep(fogNear, fogFar, depth);
      finalColor = mix(finalColor, fogColor, fogFactor);
    }

    gl_FragColor = vec4(finalColor, texColor.a);
  }
`

export interface BlockMaterialOptions {
  map?: THREE.Texture
  alphaTest?: number
  transparent?: boolean
}

export class BlockMaterial extends THREE.ShaderMaterial {
  constructor(options: BlockMaterialOptions = {}) {
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        map: { value: options.map ?? null },
        alphaTest: { value: options.alphaTest ?? 0.1 },

        // Lighting - will be updated by WorldRendererThree
        ambientLightColor: { value: new THREE.Color(0xcccccc) },
        ambientLightIntensity: { value: 1.0 },
        directionalLightDir: { value: new THREE.Vector3(1, 1, 0.5).normalize() },
        directionalLightColor: { value: new THREE.Color(0xffffff) },
        directionalLightIntensity: { value: 0.5 },

        // Fog
        useFog: { value: false },
        fogColor: { value: new THREE.Color(0x0000ff) },
        fogNear: { value: 0.1 },
        fogFar: { value: 100 },
      },
      vertexColors: true,
      transparent: options.transparent ?? true,
      side: THREE.FrontSide,
    })
  }

  // Convenience setters for updating uniforms

  set map(texture: THREE.Texture | null) {
    this.uniforms.map.value = texture
    this.needsUpdate = true
  }

  get map(): THREE.Texture | null {
    return this.uniforms.map.value
  }

  setAmbientLight(color: THREE.Color, intensity: number) {
    this.uniforms.ambientLightColor.value.copy(color)
    this.uniforms.ambientLightIntensity.value = intensity
  }

  setDirectionalLight(direction: THREE.Vector3, color: THREE.Color, intensity: number) {
    this.uniforms.directionalLightDir.value.copy(direction).normalize()
    this.uniforms.directionalLightColor.value.copy(color)
    this.uniforms.directionalLightIntensity.value = intensity
  }

  setFog(enabled: boolean, color?: THREE.Color, near?: number, far?: number) {
    this.uniforms.useFog.value = enabled
    if (color) this.uniforms.fogColor.value.copy(color)
    if (near !== undefined) this.uniforms.fogNear.value = near
    if (far !== undefined) this.uniforms.fogFar.value = far
  }
}
