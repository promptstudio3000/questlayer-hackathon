import { ATLAS_CELL, MINES } from "../../server/layer/expedition-world.mjs";
import { SIGNAL_SITES, MARKER, WORLD_PLACES } from "../../server/layer/story-world.mjs";
import { tr } from "../i18n";

export function Minimap({
  tiles,
  x,
  z,
  heading,
  centerX = x,
  centerZ = z,
}: {
  tiles: [number, number][];
  x: number;
  z: number;
  heading: number;
  centerX?: number;
  centerZ?: number;
}) {
  const scale = 0.65;
  const project = (px: number, pz: number) => [
    80 + (px - centerX) * scale,
    80 + (pz - centerZ) * scale,
  ];
  const [homeX, homeZ] = project(0, 0),
    [meX, meZ] = project(x, z);
  return (
    <svg
      className="ml-minimap"
      viewBox="0 0 160 160"
      role="img"
      aria-label={tr("Shared discoveries around this location")}
    >
      <defs>
        <pattern
          id="ml-map-grid"
          width="10.4"
          height="10.4"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M10.4 0H0V10.4"
            fill="none"
            stroke="#31274c"
            strokeWidth="0.6"
          />
        </pattern>
      </defs>
      <rect width="160" height="160" fill="#17112a" />
      <rect width="160" height="160" fill="url(#ml-map-grid)" />
      {tiles.map(([cx, cz]) => {
        const [px, pz] = project(cx * ATLAS_CELL, cz * ATLAS_CELL);
        return (
          <rect
            key={`${cx},${cz}`}
            x={px}
            y={pz}
            width={ATLAS_CELL * scale}
            height={ATLAS_CELL * scale}
            fill="#665783"
            stroke="#9982b1"
            strokeWidth="0.4"
          />
        );
      })}
      {MINES.map((mine) => {
        const [px, pz] = project(mine.entranceX, mine.entranceZ);
        return (
          <path
            key={mine.id}
            d={`M${px} ${pz - 4}l4 4-4 4-4-4z`}
            fill="#70eee0"
            stroke="#151124"
            strokeWidth="1.5"
          />
        );
      })}
      {[...SIGNAL_SITES, { id: "marker", ...MARKER }].map(site => {
        const [px,pz] = project(site.x,site.z);
        return <rect key={site.id} x={px-3} y={pz-3} width={6} height={6} fill="#fa9de7" stroke="#17112a" strokeWidth={1.5} />;
      })}
      {WORLD_PLACES.filter(place => place.kind !== "quest").map(place => {
        const [px,pz] = project(place.x,place.z);
        return <circle key={place.id} cx={px} cy={pz} r={place.kind === "treasury" ? 3.5 : 2.8} fill={place.kind === "treasury" ? "#ffe1a2" : "#ffffff"} stroke="#151124" strokeWidth={1.5} />;
      })}
      <path
        d={`M${homeX} ${homeZ - 5}l5 5v5h-10v-5z`}
        fill="#ffe1a2"
        stroke="#151124"
        strokeWidth="1.5"
      />
      <g
        transform={`translate(${meX} ${meZ}) rotate(${(-heading * 180) / Math.PI})`}
      >
        <path
          d="M0-7L5 6 0 3-5 6Z"
          fill="white"
          stroke="#26143e"
          strokeWidth="1.5"
        />
      </g>
      <text
        x="80"
        y="12"
        textAnchor="middle"
        fill="#f4eaff"
        fontSize="10"
        fontFamily="system-ui"
      >
        N
      </text>
    </svg>
  );
}
