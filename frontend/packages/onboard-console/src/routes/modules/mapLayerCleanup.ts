export function removeMapLayersIfPresent<T>(
  map: { layers: { getLayers(): T[]; remove(layers: T[]): void } },
  layers: T[],
): void {
  try {
    const attached = map.layers.getLayers();
    const removable = layers.filter((layer) => attached.includes(layer));
    if (removable.length > 0) map.layers.remove(removable);
  } catch {
    // Azure Maps can dispose its layer manager before React runs the effect
    // cleanup. Teardown must be idempotent so navigation cannot unmount the
    // entire console because a resource layer is already gone.
  }
}
