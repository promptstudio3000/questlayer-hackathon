/* Imported first by main.tsx so it runs before any other module: the
   browser may offer installation immediately, and the document head still
   lists only the assets the served shell referenced (lazy chunks add their
   own stylesheets later). */
import { capturePwaEvents, releaseSignature } from "./pwa-state";

capturePwaEvents();
export const currentRelease = releaseSignature(document.head.innerHTML);
