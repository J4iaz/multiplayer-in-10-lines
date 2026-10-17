/* Floating Paths Background — vanilla JavaScript version.
   No React, TypeScript, Tailwind, or third-party packages required. */

(() => {
  "use strict";

  const svg = document.getElementById("floatingPathsSvg");
  const container = document.getElementById("floatingPaths");
  if (!svg || !container) return;

  // Equivalent to the React demo's position={-1}.
  const position = -1;
  const pathCount = 36;
  const svgNS = "http://www.w3.org/2000/svg";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function makePathData(i, pathPosition) {
    return `M-${380 - i * 5 * pathPosition} -${189 + i * 6}` +
      `C-${380 - i * 5 * pathPosition} -${189 + i * 6}` +
      ` -${312 - i * 5 * pathPosition} ${216 - i * 6}` +
      ` ${152 - i * 5 * pathPosition} ${343 - i * 6}` +
      `C${616 - i * 5 * pathPosition} ${470 - i * 6}` +
      ` ${684 - i * 5 * pathPosition} ${875 - i * 6}` +
      ` ${684 - i * 5 * pathPosition} ${875 - i * 6}`;
  }

  function buildPaths() {
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < pathCount; i += 1) {
      const path = document.createElementNS(svgNS, "path");
      const duration = 20 + ((i * 7) % 10); // varies smoothly from 20s to 29s
      const delay = -((i * 0.47) % duration);

      path.setAttribute("d", makePathData(i, position));
      path.setAttribute("stroke-width", String(0.5 + i * 0.03));
      path.setAttribute("stroke-opacity", String(Math.min(1, 0.1 + i * 0.03)));
      path.setAttribute("pathLength", "1");
      path.setAttribute("aria-hidden", "true");
      path.classList.add("floating-path");
      path.style.animationDuration = `${duration}s`;
      path.style.animationDelay = `${delay}s`;

      fragment.appendChild(path);
    }

    svg.appendChild(fragment);
  }

  function syncMotionPreference() {
    container.classList.toggle("reduce-motion", reduceMotion.matches);
  }

  buildPaths();
  syncMotionPreference();

  if (typeof reduceMotion.addEventListener === "function") {
    reduceMotion.addEventListener("change", syncMotionPreference);
  } else {
    // Compatibility for older Safari versions.
    reduceMotion.addListener(syncMotionPreference);
  }
})();
