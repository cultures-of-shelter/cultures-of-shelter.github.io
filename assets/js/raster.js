(function () {
  "use strict";

  const CONFIG = {
    wideShare: 0.3,           // Anteil der Räumedie zufällig doppelt breit werden
    openCorner: 0.5,          // Chance auf die offene Ecke oben links mit der Legende (0 = nie, 1 = immer)
    yards: [0.25, 0.5, 0.25], // Wahrscheinlichkeit für 0 1 oder 2 Höfe
    yardKinds: {              // Gewichtung der Hofarten
      corner: 1,              // Ecke oben rechts/links (2 Seiten bebaut)
      side: 1,                // Einbuchtung außen liks/rechts (3 Seiten bebaut)
      court: 1,               // Hof oben in der Mittenach oben offen (3 Seiten bebaut)
    },
    yardWide: 0.35,           // Chance, dass ein Hof 2 Felder breit ist
    yardTall: 0.4,            // Chance, dass ein Hof 2 Felder hoch ist
  };

  const SEED = (Math.random() * 4294967296) >>> 0;

  function rand(key) {
    let h = (2166136261 ^ SEED) >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  const html = document.documentElement;
  setTimeout(() => html.classList.add("fp-ready"), 2000);

  const K = (c, r) => c + "," + r;
  const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function bounds(taken) {
    let minC = Infinity, maxC = -Infinity, minR = Infinity, maxR = -Infinity;
    taken.forEach((_, k) => {
      const [c, r] = k.split(",").map(Number);
      minC = Math.min(minC, c);
      maxC = Math.max(maxC, c);
      minR = Math.min(minR, r);
      maxR = Math.max(maxR, r);
    });
    return { minC, maxC, minR, maxR };
  }

  // Alle freien Felder, die von außen erreichbar sind.
  function outside(taken, bx) {
    const seen = new Set();
    const stack = [[bx.minC - 1, bx.minR - 1]];
    while (stack.length) {
      const [c, r] = stack.pop();
      if (c < bx.minC - 1 || c > bx.maxC + 1 || r < bx.minR - 1 || r > bx.maxR + 1) continue;
      const k = K(c, r);
      if (seen.has(k) || taken.has(k)) continue;
      seen.add(k);
      NEIGHBORS.forEach(([dc, dr]) => stack.push([c + dc, r + dr]));
    }
    return seen;
  }

  // Keine Innenhöfe: ringsum eingeschlossene Lücken werden geschlossen.
  function fillHoles(pos, taken) {
    for (let guard = 0; guard < 50; guard++) {
      const bx = bounds(taken);
      const out = outside(taken, bx);
      let hole = null;
      for (let r = bx.minR; r <= bx.maxR && !hole; r++)
        for (let c = bx.minC; c <= bx.maxC && !hole; c++)
          if (!taken.has(K(c, r)) && !out.has(K(c, r))) hole = [c, r];
      if (!hole) return;

      const [c, r] = hole;
      const single = (i) => i !== undefined && pos[i][2] === 1;
      const left = taken.get(K(c - 1, r));
      const right = taken.get(K(c + 1, r));
      if (single(left)) {
        pos[left] = [c - 1, r, 2];
        taken.set(K(c, r), left);
      } else if (single(right)) {
        pos[right] = [c, r, 2];
        taken.set(K(c, r), right);
      } else {
        let mover = -1;
        for (let i = pos.length - 1; i >= 0 && mover < 0; i--) {
          const [pc, pr, pw] = pos[i];
          if (pw === 1 && NEIGHBORS.some(([dc, dr]) => out.has(K(pc + dc, pr + dr)))) mover = i;
        }
        if (mover < 0) return;
        taken.delete(K(pos[mover][0], pos[mover][1]));
        pos[mover] = [c, r, 1];
        taken.set(K(c, r), mover);
      }
    }
  }

  // Reihenweise füllen. Passt ein breiter Raum nicht, rückt er weiter
  // und der nächste schmale Raum füllt die Lücke.
  function place(wide, C, blocked) {
    const taken = new Map();
    const free = (c, r) => c >= 0 && c < C && r >= 0 && !taken.has(K(c, r)) && !blocked(c, r);
    const cell = (n) => [n % C, Math.floor(n / C)];
    let cur = 0;

    const pos = wide.map((wantWide, i) => {
      while (!free(...cell(cur))) cur++;
      let spot = null;
      for (let n = cur; !spot && n < cur + 6 * C; n++) {
        const [c, r] = cell(n);
        if (!free(c, r)) continue;
        if (!wantWide) spot = [c, r, 1];
        else if (free(c + 1, r)) spot = [c, r, 2];
      }
      if (!spot) spot = [...cell(cur), 1];
      for (let d = 0; d < spot[2]; d++) taken.set(K(spot[0] + d, spot[1]), i);
      return spot;
    });

    fillHoles(pos, taken);
    return { pos, taken };
  }

  function pickKind(key) {
    const kinds = Object.entries(CONFIG.yardKinds).filter(([, w]) => w > 0);
    const total = kinds.reduce((s, [, w]) => s + w, 0);
    let x = rand(key) * total;
    for (const [name, w] of kinds) {
      if ((x -= w) < 0) return name;
    }
    return kinds.length ? kinds[kinds.length - 1][0] : null;
  }

  // Höfe liegen immer an der Außenkante: oben, links oder rechts offen.
  function chooseYards(C, rows, n, reserved) {
    const yards = [];
    if (C < 2 || rows < 3 || n < 2 * C + 2) return yards;
    const [p0, p1] = CONFIG.yards;
    const rc = rand("yards");
    const count = rc < p0 ? 0 : rc < p0 + p1 ? 1 : 2;
    const placed = reserved.slice();
    const touches = (a, b) =>
      a.c0 <= b.c1 + 1 && b.c0 <= a.c1 + 1 && a.r0 <= b.r1 + 1 && b.r0 <= a.r1 + 1;

    for (let k = 0; k < count; k++) {
      let kind = pickKind("yk" + k);
      const left = rand("ys" + k) < 0.5;
      let w = rand("yw" + k) < CONFIG.yardWide ? 2 : 1;
      let h = rand("yh" + k) < CONFIG.yardTall ? 2 : 1;
      h = Math.min(h, rows - 2);

      if (kind === "court" && C < 3) kind = "side";
      if (kind === "side" && rows - 1 - h < 1) kind = "corner";

      let y;
      if (kind === "court") {
        w = Math.min(w, C - 2);
        const c0 = 1 + Math.floor(rand("yc" + k) * (C - 1 - w));
        y = { c0, c1: c0 + w - 1, r0: 0, r1: h - 1 };
      } else if (kind === "side") {
        w = Math.min(w, Math.max(1, Math.floor(C / 2)));
        const r0 = 1 + Math.floor(rand("yr" + k) * (rows - 1 - h));
        const c0 = left ? 0 : C - w;
        y = { c0, c1: c0 + w - 1, r0, r1: r0 + h - 1 };
      } else {
        w = Math.min(w, C - 1);
        const c0 = left ? 0 : C - w;
        y = { c0, c1: c0 + w - 1, r0: 0, r1: h - 1 };
      }
      if (placed.some((p) => touches(p, y))) continue;
      placed.push(y);
      yards.push(y);
    }
    return yards;
  }

  function setupGrid(grid, legend) {
    if (getComputedStyle(grid).position === "static") grid.style.position = "relative";

    const box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText =
      "position:absolute;left:0;right:0;top:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
    const probe = (css) => {
      const p = document.createElement("div");
      p.style.cssText = "position:absolute;left:0;top:0;height:0;" + css;
      box.appendChild(p);
      return p;
    };
    const roomProbe = probe("width:var(--room-width, 20rem)");
    const colsProbe = probe("width:calc(var(--house-columns, 5) * 1px)");
    const textProbe = probe("width:calc(var(--wide-text, 200) * 1px)");
    grid.appendChild(box);

    if (legend) {
      grid.appendChild(legend);
      legend.classList.add("legende--plan");
    }

    let lastKey = "";

    function layout() {
      const items = Array.from(grid.children).filter((el) => el.classList.contains("item"));
      if (!items.length) return;

      const roomW = roomProbe.getBoundingClientRect().width || 320;
      const maxCols = Math.max(1, Math.round(colsProbe.getBoundingClientRect().width) || 1);
      const avail = box.getBoundingClientRect().width;
      const C = Math.max(1, Math.min(maxCols, Math.floor((avail + 0.5) / roomW)));

      const minChars = Math.round(textProbe.getBoundingClientRect().width) || 200;
      const long = items.map((el) => {
        if (!el.classList.contains("item--text")) return false;
        const gi = el.querySelector(".grid-image");
        return !!gi && gi.textContent.replace(/\s+/g, " ").trim().length >= minChars;
      });

      const key = C + "|" + items.length + "|" + minChars;
      if (key === lastKey) return;
      lastKey = key;

      const wide = items.map((el, i) =>
        C >= 2 && (long[i] || el.classList.contains("item--landscape") || rand("wide" + i) < CONFIG.wideShare));

      const corner = !!legend && C >= 2 && rand("corner") < CONFIG.openCorner;
      const reserved = corner ? [{ c0: 0, c1: 0, r0: 0, r1: 0 }] : [];
      const inRect = (c, r) => (y) => c >= y.c0 && c <= y.c1 && r >= y.r0 && r <= y.r1;

      const first = place(wide, C, (c, r) => reserved.some(inRect(c, r)));
      const rows = bounds(first.taken).maxR + 1;
      const yards = chooseYards(C, rows, items.length, reserved);
      const blocked = (c, r) => reserved.some(inRect(c, r)) || yards.some(inRect(c, r));
      const { pos, taken } = yards.length ? place(wide, C, blocked) : first;

      const { minC, maxC } = bounds(taken);
      let spot = null;
      if (legend) {
        spot = !taken.has(K(0, 0)) && corner
          ? { c: 0, r: 0, side: "left" }
          : { c: 0, r: -1, side: "left", outside: true };
      }
      const top = spot && spot.outside ? -1 : 0;
      const left = Math.min(minC, 0);

      grid.style.gridTemplateColumns = `repeat(${maxC - left + 1}, var(--room-width, 20rem))`;
      items.forEach((el, i) => {
        const [c, r, w] = pos[i];
        el.style.gridColumn = `${c - left + 1} / span ${w}`;
        el.style.gridRow = String(r - top + 1);
        el.classList.toggle("item--wide", w === 2);
        el.classList.toggle("item--longtext", long[i]);
        const gi = el.querySelector(".grid-image");
        if (gi) gi.style.maxWidth = long[i] && w === 2 ? "none" : "";
      });
      if (legend) {
        legend.style.gridColumn = String(spot.c - left + 1);
        legend.style.gridRow = String(spot.r - top + 1);
        legend.classList.toggle("legende--left", spot.side === "left");
        legend.classList.toggle("legende--right", spot.side === "right");
        legend.classList.toggle("legende--outside", !!spot.outside);
      }

      grid.dispatchEvent(new CustomEvent("floorplan:layout"));
    }

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        layout();
      });
    };
    const ro = new ResizeObserver(schedule);
    [box, roomProbe, colsProbe, textProbe].forEach((el) => ro.observe(el));
    window.addEventListener("resize", schedule);

    layout();
  }

  function init() {
    const grids = document.querySelectorAll(".grid");
    const legend = document.querySelector(".legende");
    grids.forEach((grid, i) => setupGrid(grid, i === 0 ? legend : null));
    if (!grids.length) html.classList.add("fp-ready");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();