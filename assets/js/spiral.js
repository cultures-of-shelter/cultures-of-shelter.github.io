(function () {
  "use strict";

  const CONFIG = {
    wideShare: 1 / 6,
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

  function spiralOrder(cMin, cMax, count) {
    const order = [[0, 0]];
    const ok = (c) => c >= cMin && c <= cMax;
    for (let k = 1; order.length < count; k++) {
      for (let r = -k + 1; r <= k; r++) if (ok(k)) order.push([k, r]);
      for (let c = k - 1; c >= -k; c--) if (ok(c)) order.push([c, k]);
      for (let r = k - 1; r >= -k; r--) if (ok(-k)) order.push([-k, r]);
      for (let c = -k + 1; c <= k; c++) if (ok(c)) order.push([c, -k]);
    }
    return order;
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

      const cMin = -Math.floor((C - 1) / 2);
      const cMax = cMin + C - 1;
      const inside = (c) => c >= cMin && c <= cMax;
      const order = spiralOrder(cMin, cMax, items.length * 2 + 4 * C + 8);
      const taken = new Set();
      const K = (c, r) => c + "," + r;
      let first = 0;

      const pos = items.map((el, i) => {
        const wide = C >= 2 && (long[i] || el.classList.contains("item--landscape") || rand("wide" + i) < CONFIG.wideShare);
        while (first < order.length && taken.has(K(...order[first]))) first++;
        let place = null;
        for (let j = first; j < order.length && !place; j++) {
          const [c, r] = order[j];
          if (taken.has(K(c, r))) continue;
          if (!wide) place = [c, r, 1];
          else if (inside(c + 1) && !taken.has(K(c + 1, r))) place = [c, r, 2];
          else if (inside(c - 1) && !taken.has(K(c - 1, r))) place = [c - 1, r, 2];
        }
        if (!place) place = [order[first][0], order[first][1], 1];
        for (let d = 0; d < place[2]; d++) taken.add(K(place[0] + d, place[1]));
        return place;
      });

      let minC = Infinity, maxC = -Infinity, minR = Infinity;
      taken.forEach((k) => {
        const [c, r] = k.split(",").map(Number);
        minC = Math.min(minC, c);
        maxC = Math.max(maxC, c);
        minR = Math.min(minR, r);
      });

      let spot = null;
      if (legend) {
        if (!taken.has(K(minC, minR))) spot = { c: minC, r: minR, side: "left" };
        else if (!taken.has(K(maxC, minR))) spot = { c: maxC, r: minR, side: "right" };
        else spot = { c: minC, r: minR - 1, side: "left", outside: true };
      }
      const top = spot && spot.outside ? minR - 1 : minR;

      grid.style.gridTemplateColumns = `repeat(${maxC - minC + 1}, var(--room-width, 20rem))`;
      items.forEach((el, i) => {
        const [c, r, w] = pos[i];
        el.style.gridColumn = `${c - minC + 1} / span ${w}`;
        el.style.gridRow = String(r - top + 1);
        el.classList.toggle("item--wide", w === 2);
        el.classList.toggle("item--longtext", long[i]);
        const gi = el.querySelector(".grid-image");
        if (gi) gi.style.maxWidth = long[i] && w === 2 ? "none" : "";
      });
      if (legend) {
        legend.style.gridColumn = String(spot.c - minC + 1);
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