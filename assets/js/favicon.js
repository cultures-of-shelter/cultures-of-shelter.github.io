// Animiertes Favicon: das Haus vom Nikolaus, alle 44 Lösungen nacheinander.
// Pixelgenau gezeichnet: 16 px mit 1-px-Linien für normale Bildschirme,
// 32 px mit 2-px-Linien für hochauflösende. favicon.gif zeigt dieselben Pixel.
(function () {
  "use strict";

  const CONFIG = {
    background: "tan",  // Hintergrund (CSS-Farbe)
    stroke: "#000",     // Strichfarbe
    strokeTime: 180,    // ms pro Strich – eine Silbe von „Das ist das Haus vom Ni-ko-laus“
    holdTime: 1000,     // ms Pause, wenn ein Haus fertig ist
    parts: { AC: 3, BD: 3 }, // Frames pro Strich: lange Diagonalen 3, alle anderen 2
  };

  // Jede Kante als Folge von Stempeln: [x, y, dx, dy, Schritte, Stiftbreite, Stifthöhe].
  // Gestempelt wird vom ersten zum zweiten Buchstaben:
  // A unten links, B unten rechts, C Traufe rechts, D Traufe links, E Giebel.
  const DESIGNS = {
    16: {
      AB: [3, 14, 1, 0, 9, 1, 1], AC: [3, 14, 1, -1, 9, 1, 1], AD: [3, 14, 0, -1, 9, 1, 1],
      BC: [12, 14, 0, -1, 9, 1, 1], BD: [12, 14, -1, -1, 9, 1, 1], CD: [12, 5, -1, 0, 9, 1, 1],
      CE: [12, 5, -1, -1, 4, 1, 1], DE: [3, 5, 1, -1, 4, 1, 1],
    },
    32: {
      AB: [6, 29, 1, 0, 18, 2, 2], AC: [6, 29, 1, -1, 18, 2, 1], AD: [6, 29, 0, -1, 19, 2, 2],
      BC: [24, 29, 0, -1, 19, 2, 2], BD: [24, 29, -1, -1, 18, 2, 1], CD: [24, 10, -1, 0, 18, 2, 2],
      CE: [24, 10, -1, -1, 9, 2, 1], DE: [6, 10, 1, -1, 9, 2, 1],
    },
  };
  const EDGES = ["AB", "AC", "AD", "BC", "BD", "CD", "CE", "DE"];

  // Alle Wege, die jede Kante genau einmal nutzen (Start unten links)
  function solve(node, used, path, out) {
    if (used.size === EDGES.length) return out.push(path);
    EDGES.forEach((e) => {
      if (used.has(e) || !e.includes(node)) return;
      const next = e[0] === node ? e[1] : e[0];
      solve(next, new Set(used).add(e), path.concat(next), out);
    });
    return out;
  }
  const solutions = solve("A", new Set(), ["A"], []);

  const edgeName = (a, b) => (a < b ? a + b : b + a);
  const partsOf = (name) => CONFIG.parts[name] || 2;

  function stamps(edge) {
    const [x, y, dx, dy, n, w, h] = edge;
    return Array.from({ length: n + 1 }, (_, k) => [x + dx * k, y + dy * k, w, h]);
  }

  // Ablauf: fertiges Haus, dann jede Lösung Strich für Strich in Teilstücken.
  // Das letzte fertige Haus entfällt, weil die Schleife damit wieder beginnt.
  const steps = [{ full: true, delay: CONFIG.holdTime }];
  solutions.forEach((path, s) => {
    for (let j = 0; j < EDGES.length; j++) {
      const parts = partsOf(edgeName(path[j], path[j + 1]));
      for (let i = 1; i <= parts; i++) {
        const done = j === EDGES.length - 1 && i === parts;
        steps.push({ s, j, i, delay: done ? CONFIG.holdTime : CONFIG.strokeTime / parts });
      }
    }
  });
  steps.pop();

  function stampsFor(size, step) {
    const D = DESIGNS[size];
    if (step.full) return EDGES.flatMap((e) => stamps(D[e]));
    const path = solutions[step.s];
    const out = [];
    for (let k = 0; k <= step.j; k++) {
      const name = edgeName(path[k], path[k + 1]);
      let st = stamps(D[name]);
      if (name[0] !== path[k]) st.reverse();
      if (k === step.j) st = st.slice(0, Math.ceil(((st.length - 1) * step.i) / partsOf(name)) + 1);
      out.push(...st);
    }
    return out;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/png";

  function render(step) {
    // Tabs zeigen Favicons mit 16 CSS-Pixeln: ab doppelter Pixeldichte die 32-px-Zeichnung
    const size = (window.devicePixelRatio || 1) >= 1.5 ? 32 : 16;
    canvas.width = canvas.height = size;
    ctx.fillStyle = CONFIG.background;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = CONFIG.stroke;
    stampsFor(size, step).forEach(([x, y, w, h]) => ctx.fillRect(x, y, w, h));
    link.href = canvas.toDataURL("image/png");
  }

  // Bei reduzierter Bewegung nur das fertige Haus zeigen
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    render(steps[0]);
    return;
  }

  let n = 0;
  function tick() {
    const step = steps[n];
    render(step);
    n = (n + 1) % steps.length;
    setTimeout(tick, step.delay);
  }
  tick();
})();