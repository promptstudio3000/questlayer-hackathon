export function ghostSvg(color = "#b6a1df", hat = false) {
  const safe = /^#[a-fA-F0-9]{6}$/.test(color) ? color : "#b6a1df";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56" shape-rendering="crispEdges"><ellipse cx="24" cy="51" rx="15" ry="3" fill="#493d69" opacity=".16"/><path d="M16 7h16v4h7v8h4v22h-4v8h-8v-5h-6v5h-7v-5h-6v5H7V19h4v-8h5z" fill="#4d3d6c"/><path d="M16 11h16v4h7v24h-4v6h-4v-5H15v5h-4V19h5z" fill="#fffaf0"/><path d="M32 15h7v24h-4v6h-4v-5h-7v-5h8z" fill="${safe}" opacity=".42"/><path d="M15 22h6v8h-6zm13 0h6v8h-6z" fill="#493860"/><path d="M17 22h2v3h-2zm13 0h2v3h-2z" fill="white"/><path d="M11 31h6v3h-6zm23 0h5v3h-5z" fill="#efa8bd"/><path d="M21 34h7v3h-7z" fill="${safe}"/>${hat ? `<path d="M10 11h30v5H10zm7-8h17v9H17z" fill="${safe}"/><path d="M17 9h17v3H17z" fill="#e8c864"/>` : ""}</svg>`;
}

export function auraSvg(color: string) {
  const safe = /^#[a-fA-F0-9]{6}$/.test(color) ? color : "#c2a0df";
  return ghostSvg(safe).replace(
    "</svg>",
    `<ellipse cx="24" cy="9" rx="20" ry="4" fill="none" stroke="${safe}" stroke-width="4" opacity=".2"/><ellipse cx="24" cy="9" rx="20" ry="4" fill="none" stroke="${safe}" stroke-width="1.5"/></svg>`,
  );
}

export function characterMarkerMarkup({
  color,
  above,
  below,
  skinUrl,
}: {
  color?: string;
  above?: string | null;
  below?: string | null;
  skinUrl?: string;
}) {
  const safe = (value: string | undefined | null) =>
    /^#[a-fA-F0-9]{6}$/.test(value || "") ? value : null;
  const top = safe(above),
    bottom = safe(below),
    skin =
      skinUrl &&
      (/^\/api\/aavegotchi\/skin\?tokenId=\d{1,24}$/.test(skinUrl) ||
        /^\/api\/presence\/skin\?playerId=player_[a-f0-9-]{36}$/.test(skinUrl))
        ? skinUrl
        : null;
  return `${top ? `<div class="marker-aura top" style="--aura-color:${top}"></div>` : ""}${skin ? `<img class="origin-player" src="${skin}" alt="Chosen original Aavegotchi appearance"/>` : ghostSvg(safe(color) || "#b8a1ed")}${bottom ? `<div class="marker-aura bottom" style="--aura-color:${bottom}"></div>` : ""}`;
}
