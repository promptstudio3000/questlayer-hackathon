// Open, gently irregular curtain geometry. Only its upper surface bends:
// every ground vertex stays on the published geographic boundary.
export type WallRing = readonly (readonly [number, number])[];
export function wallRibbonGeometry(
  ring: WallRing,
  height: number,
  project: (point: readonly [number, number]) => [number, number],
) {
  const positions: number[] = [],
    uvs: number[] = [];
  if (
    ring.length < 3 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    ring.some((p) => p.length !== 2 || !p.every(Number.isFinite))
  )
    return { positions: new Float32Array(), uvs: new Float32Array() };
  const points = ring.map(project);
  if (points.some((p) => p.length !== 2 || !p.every(Number.isFinite)))
    return { positions: new Float32Array(), uvs: new Float32Array() };
  if (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1])
    points.push(points[0]);
  const distances = [0];
  for (let i = 1; i < points.length; i++)
    distances.push(
      distances[i - 1] +
        Math.hypot(
          points[i][0] - points[i - 1][0],
          points[i][1] - points[i - 1][1],
        ),
    );
  const perimeter = distances.at(-1)!;
  if (perimeter < 0.01)
    return { positions: new Float32Array(), uvs: new Float32Array() };
  const pointAt = (distance: number) => {
    const d = ((distance % perimeter) + perimeter) % perimeter;
    let i = 1;
    while (i < distances.length - 1 && distances[i] < d) i++;
    const f = (d - distances[i - 1]) / (distances[i] - distances[i - 1] || 1);
    return [
      points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f,
      points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f,
    ];
  };
  const softness = Math.min(18, perimeter * 0.025);
  const levels = [0, 0.12, 0.35, 0.65, 1];
  const vertex = (x: number, z: number, along: number, f: number) => {
    // Closed harmonics join without a seam, independent of polygon vertex count.
    const a = (along / perimeter) * Math.PI * 2;
    const top =
      1 + 0.09 * Math.sin(a * 3 + 0.4) + 0.055 * Math.sin(a * 7 - 1.1);
    // A small upper-only billow; the authoritative footprint never moves.
    const bend = Math.pow(f, 1.6) * Math.min(12, height * 0.055);
    const bx = bend * (Math.sin(a * 4 + 0.6) + 0.35 * Math.sin(a * 9));
    const bz = bend * (Math.cos(a * 3 - 0.3) + 0.3 * Math.sin(a * 8));
    const before = pointAt(along - softness),
      after = pointAt(along + softness);
    const smoothX = (before[0] + 2 * x + after[0]) * 0.25,
      smoothZ = (before[1] + 2 * z + after[1]) * 0.25;
    const blend = Math.pow(f, 0.7);
    return {
      p: [
        x + (smoothX - x) * blend + bx,
        height * f * top,
        z + (smoothZ - z) * blend + bz,
      ],
      uv: [along, f],
    };
  };
  const put = (v: ReturnType<typeof vertex>) => {
    positions.push(...v.p);
    uvs.push(...v.uv);
  };
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1],
      [bx, bz] = points[i],
      length = distances[i] - distances[i - 1];
    // Subdivision allows a soft silhouette even along a straight map edge.
    const steps = Math.max(1, Math.ceil(length / 12));
    for (let j = 0; j < steps; j++) {
      const at = (t: number, f: number) =>
        vertex(
          ax + (bx - ax) * t,
          az + (bz - az) * t,
          distances[i - 1] + length * t,
          f,
        );
      for (let k = 1; k < levels.length; k++) {
        const a = at(j / steps, levels[k - 1]),
          b = at((j + 1) / steps, levels[k - 1]),
          c = at(j / steps, levels[k]),
          d = at((j + 1) / steps, levels[k]);
        put(a);
        put(b);
        put(c);
        put(c);
        put(b);
        put(d);
      }
    }
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs) };
}
