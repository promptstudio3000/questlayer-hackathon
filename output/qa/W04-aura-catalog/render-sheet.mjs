import { auraMarkup, AURA_EDITIONS } from "../../../src/aura-art-data.ts";
import sharp from "../../../node_modules/sharp/dist/index.mjs";
const S=5; let parts=[]; let y=0;
for (const frame of ["a","b"]) for (const e of AURA_EDITIONS) {
  for (const [i,slot] of ["above","below"].entries()) {
    let m = auraMarkup(e, slot, null, S);
    // show only one frame
    m = m.replace(frame==="a"?/<g class="aura-frame aura-frame-b">.*?<\/g>/:/<g class="aura-frame aura-frame-a">.*?<\/g>/,"");
    parts.push(`<g transform="translate(${(frame==="a"?0:620)+i*300},${y})">${m}</g>`);
  }
  y+=130; if (e===AURA_EDITIONS.at(-1)) y=0;
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="${130*9}"><rect width="100%" height="100%" fill="#f6f1e7"/>${parts.join("")}</svg>`;
await sharp(Buffer.from(svg)).png().toFile("/tmp/claude-0/sp/sheet.png");
