import { GRID_SIZE, terrainCell, type Workshop } from "./gotchiverse-model";
export type Face = { x: number; z: number; points: number[][] };
export function drawTerrain(
  canvas: HTMLCanvasElement,
  workshop: Workshop,
  selected: [number, number],
) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas.getBoundingClientRect();
  if (!ctx || !width || !height) return null;
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * scale;
  canvas.height = height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#e9dcfa");
  background.addColorStop(1, "#c8b1e1");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const unit = Math.min((width - 28) / 32, (height - 72) / 18),
    rise = unit * 0.72;
  const originX = width / 2,
    originY = (height - unit * 16) / 2;
  const project = (x: number, z: number) => {
    const cell = terrainCell(workshop, x, z);
    return {
      left: originX + (x - z) * unit,
      top: originY + (x + z) * unit * 0.5 - cell.height * rise,
    };
  };
  function polygon(points: number[][], fill: string, stroke?: string) {
    ctx!.beginPath();
    ctx!.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) ctx!.lineTo(x, y);
    ctx!.closePath();
    ctx!.fillStyle = fill;
    ctx!.fill();
    if (stroke) {
      ctx!.strokeStyle = stroke;
      ctx!.lineWidth = 1;
      ctx!.stroke();
    }
  }
  const faces: Face[] = [];
  for (let sum = 0; sum < GRID_SIZE * 2 - 1; sum++)
    for (let z = 0; z < GRID_SIZE; z++) {
      const x = sum - z;
      if (x < 0 || x >= GRID_SIZE) continue;
      const c = terrainCell(workshop, x, z),
        { left: px, top: py } = project(x, z),
        bottom = py + c.height * rise;
      const colors =
        c.material === "grass"
          ? ["#abd58b", "#6c8c6d", "#7d9c71"]
          : c.material === "stone"
            ? ["#c5b8d7", "#7b688d", "#9685a9"]
            : c.material === "sand"
              ? ["#eee1aa", "#a39976", "#c6b98b"]
              : ["#91d2e0", "#54899e", "#6baabd"];
      polygon(
        [
          [px - unit, py],
          [px, py + unit * 0.5],
          [px, bottom + rise + unit * 0.5],
          [px - unit, bottom + rise],
        ],
        colors[1],
      );
      polygon(
        [
          [px, py + unit * 0.5],
          [px + unit, py],
          [px + unit, bottom + rise],
          [px, bottom + rise + unit * 0.5],
        ],
        colors[2],
      );
      const points = [
        [px, py - unit * 0.5],
        [px + unit, py],
        [px, py + unit * 0.5],
        [px - unit, py],
      ];
      polygon(points, colors[0], "#3c205c25");
      faces.push({ x, z, points });
      if (x === selected[0] && z === selected[1])
        polygon(points, "#fff197b0", "#672eeb");
      if (c.object) {
        ctx.fillStyle = "#553183";
        ctx.fillRect(px - unit * 0.2, py - unit * 2, unit * 0.4, unit * 2);
        ctx.fillStyle = "#fff29a";
        ctx.fillRect(px - unit * 0.45, py - unit * 3, unit * 0.9, unit);
        ctx.fillStyle = "#76549d";
        ctx.fillRect(px - unit * 0.6, py - unit * 3.2, unit * 1.2, unit * 0.3);
      }
    }
  return { faces, project };
}
export function hitCell(
  faces: Face[],
  x: number,
  y: number,
): [number, number] | null {
  for (const face of [...faces].reverse()) {
    let inside = false;
    const p = face.points;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i],
        [xj, yj] = p[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    if (inside) return [face.x, face.z];
  }
  return null;
}
