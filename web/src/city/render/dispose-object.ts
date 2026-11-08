import { InstancedMesh, Mesh, type Object3D, ShaderMaterial, Texture } from 'three'

/** Frees the geometries, materials and textures of every mesh under `root`. */
export function disposeObject(root: Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof Mesh)) {
      return
    }
    object.geometry.dispose()
    if (object instanceof InstancedMesh) {
      object.dispose()
    }
    const materials = [object.material, object.customDepthMaterial]
      .flat()
      .filter((material) => material !== undefined)
    for (const material of materials) {
      if (material instanceof ShaderMaterial) {
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof Texture) {
            uniform.value.dispose()
          }
        }
      }
      material.dispose()
    }
  })
}
