(function () {
  "use strict";

  const CONFIG = {
    extraConnections: 0.15,
    doubleDoor: 0.06,
    slidingDoor: 0.06,
    doubleDoorFactor: 1.7,
    slidingDoorFactor: 1.5,
    windowCount: [0.1, 0.6, 0.3],
    entranceDouble: true,
    stairTypes: [1 / 3, 1 / 3, 1 / 3],
    straightSteps: 11,
    quarterSteps: 5,
    stairCut: 0.25,
    tick: 4,
    minDimLabel: 24,
  };

  const SVG_NS = "http://www.w3.org/2000/svg";
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

  const fmt = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  const num = (v) => Math.round(v * 100) / 100;

  function rect(cls, x, y, w, h) {
    if (!(w > 0 && h > 0)) return "";
    return `<rect class="${cls}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"/>`;
  }

  function line(cls, x1, y1, x2, y2) {
    return `<line class="${cls}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`;
  }

  function subtract(lo, hi, cuts) {
    const out = [];
    let cur = lo;
    cuts.slice().sort((p, q) => p[0] - q[0]).forEach(([a, c]) => {
      if (a > cur + 0.5) out.push([cur, Math.min(a, hi)]);
      cur = Math.max(cur, c);
    });
    if (hi > cur + 0.5) out.push([cur, hi]);
    return out;
  }

  function setupGrid(grid) {
    if (getComputedStyle(grid).position === "static") grid.style.position = "relative";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "floorplan");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText =
      "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none";
    grid.appendChild(svg);

    const probeBox = document.createElement("div");
    probeBox.setAttribute("aria-hidden", "true");
    probeBox.style.cssText =
      "position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
    const probes = {};
    ["--wall-outer", "--door-width", "--dim-offset", "--stair-width", "--stair-step"].forEach((name) => {
      const p = document.createElement("div");
      p.style.cssText = `position:absolute;left:0;top:0;height:0;width:var(${name})`;
      probeBox.appendChild(p);
      probes[name] = p;
    });
    const labelProbe = document.createElement("span");
    labelProbe.className = "fp-label";
    labelProbe.style.cssText = "position:absolute;left:0;top:0;display:inline-block";
    labelProbe.textContent = "00";
    probeBox.appendChild(labelProbe);
    const stairProbe = labelProbe.cloneNode(true);
    stairProbe.className = "fp-stair-text";
    probeBox.appendChild(stairProbe);
    grid.appendChild(probeBox);

    function cssLength(name, fallback) {
      if (!getComputedStyle(grid).getPropertyValue(name).trim()) return fallback;
      return probes[name].getBoundingClientRect().width;
    }

    const observed = new WeakSet();
    let lastSignature = "";

    const ro = new ResizeObserver(() => draw());
    ro.observe(grid);
    Object.values(probes).concat(labelProbe, stairProbe).forEach((p) => ro.observe(p));

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        draw();
      });
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    grid.addEventListener("floorplan:layout", schedule);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);

    function draw() {
      const items = Array.from(grid.children).filter((el) => el.classList.contains("item"));
      items.forEach((el) => {
        if (!observed.has(el)) {
          observed.add(el);
          ro.observe(el);
        }
      });
      if (!items.length) {
        svg.innerHTML = "";
        return;
      }

      const dpr = window.devicePixelRatio || 1;
      const snap = (v) => Math.round(v * dpr) / dpr;
      const origin = svg.getBoundingClientRect();
      const ox = snap(origin.left);
      const oy = snap(origin.top);

      const b = snap(parseFloat(getComputedStyle(items[0]).borderTopWidth) || 0);
      const T = Math.max(b, snap(cssLength("--wall-outer", 4 * b)));
      const t = T - b;
      const W = Math.max(1, snap(cssLength("--door-width", 56)));
      const D = cssLength("--dim-offset", 30);

      const rooms = [];
      items.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        rooms.push({
          id: i,
          el,
          x0: snap(r.left) - ox,
          y0: snap(r.top) - oy,
          x1: snap(r.right) - ox,
          y1: snap(r.bottom) - oy,
          touch: { n: [], s: [], w: [], e: [] },
        });
      });
      if (!rooms.length) {
        svg.innerHTML = "";
        return;
      }

      const signature = [dpr, ox % 1, oy % 1, b, T, W, D]
        .concat(rooms.map((r) => `${r.id}:${r.x0},${r.y0},${r.x1},${r.y1}`))
        .join("|");
      if (signature === lastSignature) return;
      lastSignature = signature;

      const EPS = 0.5;
      const occupied = (x, y) => rooms.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);

      const edges = [];
      for (let i = 0; i < rooms.length; i++) {
        const A = rooms[i];
        for (let j = i + 1; j < rooms.length; j++) {
          const B = rooms[j];
          if (Math.abs(A.x1 - B.x0) < EPS || Math.abs(B.x1 - A.x0) < EPS) {
            const left = Math.abs(A.x1 - B.x0) < EPS ? A : B;
            const right = left === A ? B : A;
            const lo = Math.max(A.y0, B.y0);
            const hi = Math.min(A.y1, B.y1);
            if (hi - lo > EPS) {
              left.touch.e.push([lo, hi]);
              right.touch.w.push([lo, hi]);
              edges.push({ a: left, b: right, vertical: true, pos: left.x1, lo, hi });
            }
          }
          if (Math.abs(A.y1 - B.y0) < EPS || Math.abs(B.y1 - A.y0) < EPS) {
            const top = Math.abs(A.y1 - B.y0) < EPS ? A : B;
            const bottom = top === A ? B : A;
            const lo = Math.max(A.x0, B.x0);
            const hi = Math.min(A.x1, B.x1);
            if (hi - lo > EPS) {
              top.touch.s.push([lo, hi]);
              bottom.touch.n.push([lo, hi]);
              edges.push({ a: top, b: bottom, vertical: false, pos: top.y1, lo, hi });
            }
          }
        }
      }

      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      rooms.forEach((r) => {
        r.ext = {
          n: subtract(r.x0, r.x1, r.touch.n),
          s: subtract(r.x0, r.x1, r.touch.s),
          w: subtract(r.y0, r.y1, r.touch.w),
          e: subtract(r.y0, r.y1, r.touch.e),
        };
        minX = Math.min(minX, r.x0);
        maxX = Math.max(maxX, r.x1);
        minY = Math.min(minY, r.y0);
        maxY = Math.max(maxY, r.y1);
      });

      let walls = "";
      let gaps = "";
      let windows = "";
      let doorLines = "";
      let labels = "";
      let dims = "";
      let dimsTotal = "";
      const swingBoxes = [];
      const doorZones = [];

      const startsAt = (list, v) => list.some(([a]) => Math.abs(a - v) < EPS);
      const endsAt = (list, v) => list.some(([, c]) => Math.abs(c - v) < EPS);
      rooms.forEach((r) => {
        r.ext.n.forEach(([a, c]) => (walls += rect("fp-wall", a, r.y0 - t, c - a, T)));
        r.ext.s.forEach(([a, c]) => (walls += rect("fp-wall", a, r.y1 - b, c - a, T)));
        r.ext.w.forEach(([a, c]) => (walls += rect("fp-wall", r.x0 - t, a, T, c - a)));
        r.ext.e.forEach(([a, c]) => (walls += rect("fp-wall", r.x1 - b, a, T, c - a)));
        if (startsAt(r.ext.n, r.x0) && startsAt(r.ext.w, r.y0) && !occupied(r.x0 - 1, r.y0 - 1))
          walls += rect("fp-wall", r.x0 - t, r.y0 - t, t, t);
        if (endsAt(r.ext.n, r.x1) && startsAt(r.ext.e, r.y0) && !occupied(r.x1 + 1, r.y0 - 1))
          walls += rect("fp-wall", r.x1, r.y0 - t, t, t);
        if (startsAt(r.ext.s, r.x0) && endsAt(r.ext.w, r.y1) && !occupied(r.x0 - 1, r.y1 + 1))
          walls += rect("fp-wall", r.x0 - t, r.y1, t, t);
        if (endsAt(r.ext.s, r.x1) && endsAt(r.ext.e, r.y1) && !occupied(r.x1 + 1, r.y1 + 1))
          walls += rect("fp-wall", r.x1, r.y1, t, t);
      });

      function doorBoxes(vertical, vA, vB, u0, u1, type, dir) {
        const P = vertical ? (u, v) => [v, u] : (u, v) => [u, v];
        const box = (ua, va, ub, vb) => {
          const [x1, y1] = P(ua, va);
          const [x2, y2] = P(ub, vb);
          return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
        };
        const face = dir > 0 ? vB : vA;
        const reach = type === "double" ? (u1 - u0) / 2 : u1 - u0;
        return {
          swing: type === "sliding" ? null : box(u0, face, u1, face + dir * reach),
          zones: [box(u0, vA - W, u1, vA), box(u0, vB, u1, vB + W)],
        };
      }

      const cut = (a, z) =>
        Math.max(0, Math.min(a[2], z[2]) - Math.max(a[0], z[0]) - 0.5) *
        Math.max(0, Math.min(a[3], z[3]) - Math.max(a[1], z[1]) - 0.5);
      function clash(boxes) {
        let sum = 0;
        if (boxes.swing) doorZones.forEach((z) => (sum += cut(boxes.swing, z)));
        boxes.zones.forEach((z) => swingBoxes.forEach((s) => (sum += cut(z, s))));
        return sum;
      }

      function opening(vertical, vA, vB, u0, u1, type, dir, hingeAtStart) {
        const P = vertical ? (u, v) => [v, u] : (u, v) => [u, v];
        const L = (cls, ua, va, ub, vb) => {
          const [x1, y1] = P(ua, va);
          const [x2, y2] = P(ub, vb);
          return line(cls, x1, y1, x2, y2);
        };
        const [gx1, gy1] = P(u0, vA);
        const [gx2, gy2] = P(u1, vB);
        gaps += rect("fp-gap", Math.min(gx1, gx2), Math.min(gy1, gy2), Math.abs(gx2 - gx1), Math.abs(gy2 - gy1));

        let out = L("fp-line", u0, vA, u0, vB) + L("fp-line", u1, vA, u1, vB);
        const face = dir > 0 ? vB : vA;
        const w = u1 - u0;
        const boxes = doorBoxes(vertical, vA, vB, u0, u1, type, dir);
        doorZones.push(...boxes.zones);
        if (boxes.swing) swingBoxes.push(boxes.swing);
        if (type === "sliding") {
          const vc = (vA + vB) / 2;
          const pocket = w / 2;
          out += L("fp-slide", u0, vc, u1, vc);
          out += L("fp-pocket", u0 - pocket, vc, u0, vc) + L("fp-pocket", u1, vc, u1 + pocket, vc);
        } else if (type === "double") {
          const leaf = w / 2;
          const um = (u0 + u1) / 2;
          const tip = face + dir * leaf;
          out += L("fp-leaf", u0, face, u0, tip) + L("fp-swing", u0, tip, um, face);
          out += L("fp-leaf", u1, face, u1, tip) + L("fp-swing", u1, tip, um, face);
        } else {
          const h = hingeAtStart ? u0 : u1;
          const o = hingeAtStart ? u1 : u0;
          const tip = face + dir * w;
          out += L("fp-leaf", h, face, h, tip) + L("fp-swing", h, tip, o, face);
        }
        doorLines += out;
      }

      const margin = Math.max(b, W * 0.25);
      edges.forEach((ed) => {
        ed.key = Math.min(ed.a.id, ed.b.id) + "-" + Math.max(ed.a.id, ed.b.id);
        ed.r0 = ed.lo + b + margin;
        ed.r1 = ed.hi - b - margin;
      });
      const usable = edges.filter((ed) => ed.r1 - ed.r0 >= W);
      usable.sort((p, q) => rand("w" + p.key) - rand("w" + q.key));

      const parent = new Map(rooms.map((r) => [r.id, r.id]));
      const find = (x) => {
        while (parent.get(x) !== x) {
          parent.set(x, parent.get(parent.get(x)));
          x = parent.get(x);
        }
        return x;
      };
      const doorWalls = new Set();
      const wallsOf = (ed) => (ed.vertical ? [ed.a.id + "e", ed.b.id + "w"] : [ed.a.id + "s", ed.b.id + "n"]);
      const wallsFree = (ed) => wallsOf(ed).every((k) => !doorWalls.has(k));
      const connected = [];
      const connect = (ed) => {
        connected.push(ed);
        wallsOf(ed).forEach((k) => doorWalls.add(k));
      };
      const join = (ed) => {
        const ra = find(ed.a.id);
        const rb = find(ed.b.id);
        if (ra === rb) return;
        parent.set(ra, rb);
        connect(ed);
      };
      usable.forEach((ed) => {
        if (wallsFree(ed)) join(ed);
      });
      usable.forEach(join);
      usable.forEach((ed) => {
        if (wallsFree(ed) && rand("x" + ed.key) < CONFIG.extraConnections) connect(ed);
      });

      const widthOf = (type) =>
        snap(type === "double" ? W * CONFIG.doubleDoorFactor : type === "sliding" ? W * CONFIG.slidingDoorFactor : W);
      const pickType = (key) => {
        const r = rand("t" + key);
        if (r < CONFIG.doubleDoor) return "double";
        if (r < CONFIG.doubleDoor + CONFIG.slidingDoor) return "sliding";
        return "single";
      };

      let entrance = null;
      const centerX = (minX + maxX) / 2;
      const entranceWidths = CONFIG.entranceDouble ? [widthOf("double"), W] : [W];
      rooms.forEach((r) => {
        if (Math.abs(r.y0 - minY) > EPS) return;
        if (doorWalls.has(r.id + "n")) return;
        r.ext.n.forEach(([a, c]) => {
          const lo = Math.max(a, r.x0 + b + margin);
          const hi = Math.min(c, r.x1 - b - margin);
          const w = entranceWidths.find((ew) => hi - lo >= ew);
          if (!w) return;
          const s = snap(Math.min(Math.max(centerX - w / 2, lo), hi - w));
          const dist = Math.abs(s + w / 2 - centerX);
          if (!entrance || dist < entrance.dist - EPS) entrance = { r, s, w, dist };
        });
      });
      if (entrance) {
        const r = entrance.r;
        const type = entrance.w > W ? "double" : "single";
        opening(false, r.y0 - t, r.y0 + b, entrance.s, entrance.s + entrance.w, type, 1, rand("entrance") < 0.5);
      }

      connected.forEach((ed) => {
        const L = ed.r1 - ed.r0;
        let type = pickType(ed.key);
        let w = widthOf(type);
        if (w > L) {
          type = "single";
          w = W;
        }
        const free = L - w;
        const want = ed.r0 + free * rand("p" + ed.key);
        const wantDir = rand("s" + ed.key) < 0.5 ? -1 : 1;
        const spots = [want].concat(
          Array.from({ length: 9 }, (_, i) => ed.r0 + (free * i) / 8)
            .sort((p, q) => Math.abs(p - want) - Math.abs(q - want)));
        let best = null;
        for (const pos of spots) {
          for (const dir of [wantDir, -wantDir]) {
            const d0 = snap(pos);
            const c = clash(doorBoxes(ed.vertical, ed.pos - b, ed.pos + b, d0, d0 + w, type, dir));
            if (!best || c < best.c) best = { d0, dir, c };
            if (c === 0) break;
          }
          if (best.c === 0) break;
        }
        opening(ed.vertical, ed.pos - b, ed.pos + b, best.d0, best.d0 + w, type, best.dir, rand("h" + ed.key) < 0.5);
      });

      rooms.forEach((r) => {
        ["n", "s", "w", "e"].forEach((side) => {
          const horizontal = side === "n" || side === "s";
          r.ext[side].forEach(([a, c], k) => {
            const lo = Math.max(a, (horizontal ? r.x0 : r.y0) + b);
            const hi = Math.min(c, (horizontal ? r.x1 : r.y1) - b);
            const len = hi - lo;
            if (len < 20) return;
            const key = r.id + side + k;
            const rc = rand("wc" + key);
            const [p0, p1] = CONFIG.windowCount;
            const count = rc < p0 ? 0 : rc < p0 + p1 ? 1 : 2;
            const list = [];
            if (count === 1) {
              list.push([0.5 + (rand("wp" + key) - 0.5) * 0.3, 0.3 + rand("ww" + key) * 0.18]);
            } else if (count === 2) {
              list.push([0.27 + (rand("wp" + key) - 0.5) * 0.1, 0.2 + rand("ww" + key) * 0.08]);
              list.push([0.73 + (rand("wq" + key) - 0.5) * 0.1, 0.2 + rand("wv" + key) * 0.08]);
            }
            const vA = side === "n" ? r.y0 - t : side === "s" ? r.y1 - b : side === "w" ? r.x0 - t : r.x1 - b;
            const vB = vA + T;
            const vc = (vA + vB) / 2;
            list.forEach(([center, width]) => {
              const ww = len * width;
              let s = lo + len * center - ww / 2;
              s = Math.max(lo + len * 0.06, Math.min(s, hi - len * 0.06 - ww));
              const u0 = snap(s);
              const u1 = snap(s + ww);
              if (u1 - u0 < 6) return;
              if (entrance && side === "n" && r === entrance.r &&
                  u0 < entrance.s + entrance.w + margin && u1 > entrance.s - margin) return;
              if (horizontal) {
                windows += rect("fp-window", u0, vA, u1 - u0, T) + line("fp-line", u0, vc, u1, vc);
              } else {
                windows += rect("fp-window", vA, u0, T, u1 - u0) + line("fp-line", vc, u0, vc, u1);
              }
            });
          });
        });
      });

      const SW = Math.max(8, snap(cssLength("--stair-width", W)));
      const SS = Math.max(3, cssLength("--stair-step", 10));
      const sfs = parseFloat(getComputedStyle(stairProbe).fontSize) || 9;
      const VIS = "fp-stair";
      const HID = "fp-stair-hidden";
      const cutOf = (n) => Math.max(2, Math.round(n * CONFIG.stairCut));
      const overlapArea = (a, list) =>
        list.reduce((sum, z) =>
          sum + Math.max(0, Math.min(a[2], z[2]) - Math.max(a[0], z[0])) *
                Math.max(0, Math.min(a[3], z[3]) - Math.max(a[1], z[1])), 0);

      function stairCtx(f) {
        const X = (p, q) => [f.ox + p * f.e1[0] + q * f.e2[0], f.oy + p * f.e1[1] + q * f.e2[1]];
        const dirOf = (dp, dq) => [dp * f.e1[0] + dq * f.e2[0], dp * f.e1[1] + dq * f.e2[1]];
        const pts = (list) => list.map(([p, q]) => X(p, q).map(num).join(",")).join(" ");
        return {
          box([p0, q0, p1, q1]) {
            const [ax, ay] = X(p0, q0);
            const [bx, by] = X(p1, q1);
            return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
          },
          seg(cls, p0, q0, p1, q1) {
            const [ax, ay] = X(p0, q0);
            const [bx, by] = X(p1, q1);
            return line(cls, ax, ay, bx, by);
          },
          poly: (cls, list) => `<polygon class="${cls}" points="${pts(list)}"/>`,
          polyline: (cls, list) => `<polyline class="${cls}" points="${pts(list)}"/>`,
          path(cls, cmds) {
            const d = cmds.map(([c, ...v]) => {
              const out = [];
              for (let i = 0; i < v.length; i += 2) out.push(X(v[i], v[i + 1]).map(num).join(" "));
              return c + out.join(" ");
            }).join(" ");
            return `<path class="${cls}" d="${d}"/>`;
          },
          circle(cls, p, q, r) {
            const [cx, cy] = X(p, q);
            return `<circle class="${cls}" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"/>`;
          },
          arrow(p, q, dp, dq) {
            const l = Math.hypot(dp, dq) || 1;
            const ux = dp / l, uy = dq / l;
            return `<polygon class="fp-stair-arrow" points="${pts([
              [p, q],
              [p - 6 * ux - 2.5 * uy, q - 6 * uy + 2.5 * ux],
              [p - 6 * ux + 2.5 * uy, q - 6 * uy - 2.5 * ux],
            ])}"/>`;
          },
          label(p, q, dp, dq, text) {
            const [x, y] = X(p, q);
            const [dx, dy] = dirOf(dp, dq);
            let anchor = "middle";
            let tx = x + dx * 4;
            let ty = y + dy * 4;
            if (Math.abs(dx) > 0.3) anchor = dx > 0 ? "start" : "end";
            if (dy > 0.3) ty += sfs * 0.8;
            else if (Math.abs(dy) <= 0.3) ty += sfs * 0.35;
            return `<text class="fp-stair-text" x="${num(tx)}" y="${num(ty)}" text-anchor="${anchor}">${text}</text>`;
          },
        };
      }

      function stairShape(type) {
        const w = SW;
        const s = SS;
        const labelLen = 48;

        if (type === "straight") {
          const n = CONFIG.straightSteps;
          const L = n * s;
          return {
            foot: [[0, 0, L, w]],
            label: [L, 0, L + labelLen, w],
            draw(S) {
              const cut = cutOf(n);
              const pc = L - cut * s;
              let o = S.poly("fp-stair-bg", [[0, 0], [L, 0], [L, w], [0, w]]);
              for (let j = 0; j <= n; j++) o += S.seg(j <= cut ? VIS : HID, L - j * s, 0, L - j * s, w);
              o += S.seg(VIS, 0, 0, L, 0);
              o += S.seg(VIS, pc, w, L, w) + S.seg(HID, 0, w, pc, w);
              o += S.polyline("fp-stair-walk", [[L, w / 2], [6, w / 2]]);
              o += S.circle("fp-stair-dot", L - 3, w / 2, 2);
              o += S.arrow(0, w / 2, -1, 0);
              o += S.label(L, w / 2, 1, 0, `${n + 1} Stg.`);
              return o;
            },
          };
        }

        if (type === "quarter") {
          const nB = CONFIG.quarterSteps;
          const nA = CONFIG.quarterSteps;
          const LB = nB * s;
          const LA = nA * s;
          const T = nB + 3 + nA;
          return {
            foot: [[0, 0, w, w + LB], [w, 0, w + LA, w]],
            label: [0, w + LB, w, w + LB + labelLen],
            draw(S) {
              const cut = cutOf(T);
              const cls = (i) => (i <= cut ? VIS : HID);
              const k = w * (1 - Math.tan(Math.PI / 6));
              let o = S.poly("fp-stair-bg", [[0, 0], [w + LA, 0], [w + LA, w], [w, w], [w, w + LB], [0, w + LB]]);
              for (let j = 0; j <= nB; j++) o += S.seg(cls(j), 0, w + LB - j * s, w, w + LB - j * s);
              o += S.seg(cls(nB + 1), w, w, 0, k) + S.seg(cls(nB + 2), w, w, k, 0);
              for (let j = 0; j <= nA; j++) o += S.seg(cls(nB + 3 + j), w + j * s, 0, w + j * s, w);
              o += S.seg(VIS, 0, 0, 0, w + LB) + S.seg(VIS, 0, 0, w + LA, 0);
              if (cut <= nB) {
                const qc = w + LB - cut * s;
                o += S.seg(VIS, w, qc, w, w + LB) + S.seg(HID, w, w, w, qc) + S.seg(HID, w, w, w + LA, w);
              } else if (cut >= nB + 3) {
                const pc = w + (cut - nB - 3) * s;
                o += S.seg(VIS, w, w, w, w + LB) + S.seg(VIS, w, w, pc, w) + S.seg(HID, pc, w, w + LA, w);
              } else {
                o += S.seg(VIS, w, w, w, w + LB) + S.seg(HID, w, w, w + LA, w);
              }
              o += S.path("fp-stair-walk", [
                ["M", w / 2, w + LB],
                ["L", w / 2, w],
                ["Q", w / 2, w / 2, w, w / 2],
                ["L", w + LA - 6, w / 2],
              ]);
              o += S.circle("fp-stair-dot", w / 2, w + LB - 3, 2);
              o += S.arrow(w + LA, w / 2, 1, 0);
              o += S.label(w / 2, w + LB, 0, 1, `${T + 1} Stg.`);
              return o;
            },
          };
        }

        const R = w;
        const r0 = Math.max(3, w * 0.16);
        const rw = r0 + (R - r0) * 0.55;
        const dth = s / rw;
        const T = Math.max(8, Math.floor((2 * Math.PI * 0.9) / dth));
        const th0 = Math.PI / 4;
        const P = (rho, th) => [R + rho * Math.cos(th), R + rho * Math.sin(th)];
        const arc = (rho, a0, a1) => {
          const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 30)));
          return Array.from({ length: n + 1 }, (_, i) => P(rho, a0 + ((a1 - a0) * i) / n));
        };
        const lp = P(R, th0);
        return {
          foot: [[0, 0, 2 * R, 2 * R]],
          label: [lp[0] - 4, lp[1] - 4, lp[0] + labelLen, lp[1] + 4 + 2 * sfs],
          draw(S) {
            const cut = cutOf(T);
            const thCut = th0 + cut * dth;
            const thEnd = th0 + T * dth;
            let o = S.circle("fp-stair-bg", R, R, R);
            o += S.polyline(VIS, arc(R, th0, thCut)) + S.polyline(HID, arc(R, thCut, thEnd));
            o += S.polyline(VIS, arc(R, thEnd, th0 + 2 * Math.PI));
            o += S.circle(VIS, R, R, r0);
            for (let k = 0; k <= T; k++) {
              const th = th0 + k * dth;
              o += S.seg(k <= cut ? VIS : HID, ...P(r0, th), ...P(R, th));
            }
            o += S.polyline("fp-stair-walk", arc(rw, th0, thEnd - 6 / rw));
            o += S.circle("fp-stair-dot", ...P(rw, th0 + 3 / rw), 2);
            o += S.arrow(...P(rw, thEnd), -Math.sin(thEnd), Math.cos(thEnd));
            o += S.label(...lp, Math.cos(th0), Math.sin(th0), `${T + 1} Stg.`);
            return o;
          },
        };
      }

      function contentBoxes(r) {
        const gi = r.el.querySelector(".grid-image");
        if (!gi) return [];
        const g = gi.getBoundingClientRect();
        const cs = getComputedStyle(gi);
        const out = [[
          g.left - ox + parseFloat(cs.paddingLeft),
          g.top - oy + parseFloat(cs.paddingTop),
          g.right - ox - parseFloat(cs.paddingRight),
          g.bottom - oy - parseFloat(cs.paddingBottom),
        ]];
        const before = getComputedStyle(r.el, "::before").content;
        if (before && before !== "none" && before !== "normal") {
          const cx = (g.left + g.right) / 2 - ox;
          out.push([cx - 80, g.top - oy - 24, cx + 80, g.top - oy]);
        }
        return out;
      }

      let stairs = "";
      rooms.forEach((r) => {
        if (!r.el.classList.contains("item--board")) return;
        const ix0 = r.x0 + b, ix1 = r.x1 - b, iy0 = r.y0 + b, iy1 = r.y1 - b;
        const rt = rand("st" + r.id);
        const [p1, p2] = CONFIG.stairTypes;
        const shape = stairShape(rt < p1 ? "straight" : rt < p1 + p2 ? "quarter" : "spiral");
        const content = contentBoxes(r);

        const frames = [];
        [[ix0, iy0, 1, 1], [ix1, iy0, -1, 1], [ix0, iy1, 1, -1], [ix1, iy1, -1, -1]].forEach(([fx, fy, sx, sy], ci) => {
          frames.push({ ox: fx, oy: fy, e1: [sx, 0], e2: [0, sy], key: ci + "a" });
          frames.push({ ox: fx, oy: fy, e1: [0, sy], e2: [sx, 0], key: ci + "b" });
        });
        frames.sort((fa, fb) => rand("sf" + r.id + fa.key) - rand("sf" + r.id + fb.key));

        let best = null;
        frames.forEach((f) => {
          if (best && best.cost === 0) return;
          const S = stairCtx(f);
          const boxes = shape.foot.concat([shape.label]).map((rc) => S.box(rc));
          const fits = boxes.every((bx) => bx[0] >= ix0 - 0.5 && bx[2] <= ix1 + 0.5 && bx[1] >= iy0 - 0.5 && bx[3] <= iy1 + 0.5);
          if (!fits) return;
          const cost = boxes.reduce(
            (sum, bx) => sum + 3 * overlapArea(bx, doorZones) + overlapArea(bx, content) + overlapArea(bx, swingBoxes), 0);
          if (!best || cost < best.cost) best = { S, boxes, cost };
        });
        if (!best) return;
        stairs += shape.draw(best.S);
        best.boxes.forEach((bx) => swingBoxes.push(bx));
      });

      const fs = parseFloat(getComputedStyle(labelProbe).fontSize) || 10;
      rooms.forEach((r) => {
        const w = Math.round(r.x1 - r.x0 - 2 * b);
        const h = Math.round(r.y1 - r.y0 - 2 * b);
        const line1 = `${fmt.format(w)} × ${fmt.format(h)}`;
        const line2 = `${fmt.format(w * h)} px²`;
        const bw = Math.max(line1.length, line2.length) * fs * 0.62 + fs;
        const ix0 = r.x0 + b, ix1 = r.x1 - b, iy0 = r.y0 + b, iy1 = r.y1 - b;
        const pad = 10;
        const bottom = iy1 - pad - 0.3 * fs;
        const top = iy0 + pad + 2.25 * fs;
        const candidates = [
          [(ix0 + ix1) / 2, bottom],
          [(ix0 + ix1) / 2, top],
          [ix0 + pad + bw / 2, bottom],
          [ix1 - pad - bw / 2, bottom],
          [ix0 + pad + bw / 2, top],
          [ix1 - pad - bw / 2, top],
        ];
        const free = ([x, y]) => {
          const bx0 = x - bw / 2, bx1 = x + bw / 2, by0 = y - 2.25 * fs, by1 = y + 0.3 * fs;
          return !swingBoxes.some(([sx0, sy0, sx1, sy1]) => sx0 < bx1 && sx1 > bx0 && sy0 < by1 && sy1 > by0);
        };
        const [lx, ly] = candidates.find(free) || candidates[0];
        const x = num(lx);
        const y = num(ly);
        labels +=
          `<text class="fp-label" x="${x}" y="${y}">` +
          `<tspan x="${x}" dy="-1.25em">${line1}</tspan>` +
          `<tspan x="${x}" dy="1.25em">${line2}</tspan></text>`;
      });

      const OUT = { n: -1, s: 1, w: -1, e: 1 };
      const levelOf = { n: (r) => r.y0, s: (r) => r.y1, w: (r) => r.x0, e: (r) => r.x1 };

      function chain(horizontal, chainV, faceV, o, ticks) {
        const P = horizontal ? (u, v) => [u, v] : (u, v) => [v, u];
        const L = (cls, ua, va, ub, vb) => {
          const [x1, y1] = P(ua, va);
          const [x2, y2] = P(ub, vb);
          return line(cls, x1, y1, x2, y2);
        };
        const k = CONFIG.tick;
        let out = L("fp-dim-line", ticks[0], chainV, ticks[ticks.length - 1], chainV);
        ticks.forEach((u) => {
          out += L("fp-dim-ext", u, faceV + o * 3, u, chainV + o * 4);
          const [x, y] = P(u, chainV);
          out += line("fp-dim-tick", x - k, y + k, x + k, y - k);
        });
        for (let i = 0; i < ticks.length - 1; i++) {
          const len = ticks[i + 1] - ticks[i];
          if (len < CONFIG.minDimLabel) continue;
          const mid = num((ticks[i] + ticks[i + 1]) / 2);
          out += horizontal
            ? `<text class="fp-dim-text" x="${mid}" y="${num(chainV - 3)}">${fmt.format(Math.round(len))}</text>`
            : `<text class="fp-dim-text" transform="translate(${num(chainV - 3)} ${mid}) rotate(-90)">${fmt.format(Math.round(len))}</text>`;
        }
        return out;
      }

      const levels = { n: [], s: [], w: [], e: [] };
      ["n", "s", "w", "e"].forEach((side) => {
        const horizontal = side === "n" || side === "s";
        const o = OUT[side];
        const segs = [];
        rooms.forEach((r) => r.ext[side].forEach(([a, c]) => segs.push({ level: levelOf[side](r), a, c, r })));
        segs.sort((p, q) => p.level - q.level || p.a - q.a);

        const runs = [];
        segs.forEach((sg) => {
          const last = runs[runs.length - 1];
          if (last && Math.abs(last.level - sg.level) < EPS && Math.abs(last.c - sg.a) < EPS) {
            last.c = sg.c;
            last.rooms.push(sg.r);
          } else {
            runs.push({ level: sg.level, a: sg.a, c: sg.c, rooms: [sg.r] });
          }
        });

        const occ = (u, v) => (horizontal ? occupied(u, v) : occupied(v, u));
        runs.forEach((run) => {
          levels[side].push(run.level);
          const start = occ(run.a - 1, run.level + o) ? run.a + t : run.a - t;
          const end = occ(run.c + 1, run.level + o) ? run.c - t : run.c + t;
          const ticks = [start, end];
          run.rooms.forEach((r) => {
            const faces = horizontal ? [r.x0 + b, r.x1 - b] : [r.y0 + b, r.y1 - b];
            faces.forEach((v) => {
              if (v > start + 1 && v < end - 1) ticks.push(v);
            });
          });
          ticks.sort((p, q) => p - q);
          const unique = ticks.filter((v, i) => i === 0 || v - ticks[i - 1] > 0.5);
          const faceV = run.level + o * t;
          dims += chain(horizontal, faceV + o * D, faceV, o, unique);
        });
      });

      if (levels.n.length) {
        const faceV = Math.min(...levels.n) - t;
        dimsTotal += chain(true, faceV - 2 * D, faceV, -1, [minX - t, maxX + t]);
      }
      if (levels.w.length) {
        const faceV = Math.min(...levels.w) - t;
        dimsTotal += chain(false, faceV - 2 * D, faceV, -1, [minY - t, maxY + t]);
      }

      svg.innerHTML =
        `<g class="fp-walls">${walls}</g>` +
        `<g class="fp-openings">${gaps}${windows}${doorLines}</g>` +
        `<g class="fp-stairs">${stairs}</g>` +
        `<g class="fp-labels">${labels}</g>` +
        `<g class="fp-dims">${dims}<g class="fp-dim-total">${dimsTotal}</g></g>`;
    }

    draw();
  }

  function init() {
    document.querySelectorAll(".grid").forEach(setupGrid);
    document.documentElement.classList.add("fp-ready");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();