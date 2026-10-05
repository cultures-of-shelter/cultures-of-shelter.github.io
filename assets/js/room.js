(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const TILT_RANGE = 20;
  const EASE = 0.12;
  const RECENTER = 0.004;
  const FRAME = 2;
  const MIN_BACK = 0.2;
  const DEPTH = 1.5;
  const SCROLL_EASE = 0.3;
  const GLIDE = 0.95;

  const DEFAULTS = {
    "--room-wall-left": "12% 24%",
    "--room-wall-right": "12% 24%",
    "--room-wall-top": "7% 16%",
    "--room-wall-bottom": "7% 16%",
    "--room-tilt-x": "40px",
    "--room-tilt-y": "30px",
    "--room-sway": "24px",
    "--room-projection": "1",
  };

  function quadMatrix(w, h, q) {
    const [[X0, Y0], [X1, Y1], [X2, Y2], [X3, Y3]] = q;
    const dx1 = X1 - X2, dx2 = X3 - X2, dx3 = X0 - X1 + X2 - X3;
    const dy1 = Y1 - Y2, dy2 = Y3 - Y2, dy3 = Y0 - Y1 + Y2 - Y3;
    let g = 0, k = 0;
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) > 1e-9 && (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9)) {
      g = (dx3 * dy2 - dx2 * dy3) / den;
      k = (dx1 * dy3 - dx3 * dy1) / den;
    }
    const a = X1 - X0 + g * X1, b = X3 - X0 + k * X3;
    const d = Y1 - Y0 + g * Y1, e = Y3 - Y0 + k * Y3;
    const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, X0, Y0, 0, 1];
    return "matrix3d(" + m.map((v) => +v.toFixed(8)).join(",") + ")";
  }

  const clamp = (v, a, b) => (a > b ? (a + b) / 2 : Math.min(b, Math.max(a, v)));
  const media = (q) => !!window.matchMedia && window.matchMedia(q).matches;

  function tokens(raw) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of raw.trim()) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (/\s/.test(ch) && depth === 0) {
        if (cur) out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function setupRoom(stage) {
    const wall = stage.querySelector(".room-wall");
    if (!wall) return;
    if (getComputedStyle(stage).position === "static") stage.style.position = "relative";

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "room-lines");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none";
    const faces = {};
    ["back", "ceiling", "right", "floor", "left"].forEach((name) => {
      const p = document.createElementNS(SVG_NS, "polygon");
      p.setAttribute("class", "room-" + name);
      svg.appendChild(p);
      faces[name] = p;
    });
    stage.insertBefore(svg, stage.firstChild);

    function projection(kind) {
      const win = document.createElement("div");
      win.className = "room-projection room-projection--" + kind;
      win.setAttribute("aria-hidden", "true");
      win.style.cssText = "position:absolute;left:0;top:0;overflow:hidden;transform-origin:0 0;pointer-events:none";
      const clone = wall.cloneNode(true);
      clone.classList.add("room-clone");
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
      clone.inert = true;
      clone.style.overflow = "visible";
      win.appendChild(clone);
      stage.insertBefore(win, svg);
      return { win, clone, depth: 0 };
    }
    const ceiling = projection("ceiling");
    const floor = projection("floor");

    const front = document.querySelector(".room-front");
    let flat = null;
    let movers = [];
    if (front) {
      movers = Array.from(front.children);
      flat = projection("front");
      front.appendChild(flat.win);
      flat.win.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none";
      flat.clone.style.transformOrigin = "0 0";
    }

    const dice = {
      left: Math.random(), right: Math.random(), top: Math.random(), bottom: Math.random(),
      tiltX: Math.random(), tiltY: Math.random(),
    };

    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none";
    stage.appendChild(probe);

    function px(token, axis) {
      const s = stage.getBoundingClientRect();
      probe.style.left = "0px";
      probe.style.top = "0px";
      if (axis === "x") {
        probe.style.left = token;
        return probe.getBoundingClientRect().left - s.left;
      }
      probe.style.top = token;
      return probe.getBoundingClientRect().top - s.top;
    }

    const cssValue = (name) => getComputedStyle(stage).getPropertyValue(name).trim() || DEFAULTS[name];

    function pick(name, axis, t, symmetric) {
      const v = tokens(cssValue(name)).slice(0, 2).map((tok) => px(tok, axis));
      if (!v.length) return 0;
      const [a, b] = v.length > 1 ? v : symmetric ? [-v[0], v[0]] : [v[0], v[0]];
      return a + (b - a) * t;
    }

    let W = 0, H = 0;
    let ww = 1, frontH = 0;
    let half = 0.5;
    let wl = 0, wr = 0, wt = 0, wb = 0;
    let tiltX = 0, tiltY = 0, sway = 0;
    const cur = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

    function fit() {
      const top = stage.getBoundingClientRect().top + window.scrollY;
      const body = getComputedStyle(document.body);
      const below = (parseFloat(getComputedStyle(stage).marginBottom) || 0) +
        (parseFloat(body.paddingBottom) || 0) + (parseFloat(body.marginBottom) || 0);
      stage.style.setProperty("--room-fill", Math.max(320, Math.floor(window.innerHeight - top - below)) + "px");
    }

    function measure() {
      fit();
      W = stage.clientWidth;
      H = stage.clientHeight;
      wl = Math.max(0, pick("--room-wall-left", "x", dice.left));
      wr = Math.max(0, pick("--room-wall-right", "x", dice.right));
      wt = Math.max(0, pick("--room-wall-top", "y", dice.top));
      wb = Math.max(0, pick("--room-wall-bottom", "y", dice.bottom));
      const maxX = W * (1 - MIN_BACK);
      const maxY = H * (1 - MIN_BACK);
      if (wl + wr > maxX) { const k = maxX / (wl + wr); wl *= k; wr *= k; }
      if (wt + wb > maxY) { const k = maxY / (wt + wb); wt *= k; wb *= k; }
      tiltX = pick("--room-tilt-x", "x", dice.tiltX, true);
      tiltY = pick("--room-tilt-y", "y", dice.tiltY, true);
      sway = px(tokens(cssValue("--room-sway"))[0] || "0px", "x");

      ww = Math.max(1, W - wl - wr);
      const wh = Math.max(0, H - wt - wb);
      wall.style.left = wl + "px";
      wall.style.top = wt + "px";
      wall.style.width = ww + "px";
      wall.style.height = wh + "px";

      const f = parseFloat(cssValue("--room-projection"));
      const factor = Number.isFinite(f) ? Math.max(0, f) : 1;
      const dy = clamp(tiltY, FRAME - wt, wb - FRAME);
      ceiling.depth = Math.max(0, wt + dy) * DEPTH * factor;
      floor.depth = Math.max(0, wb - dy) * DEPTH * factor;
      half = (parseFloat(getComputedStyle(faces.ceiling).strokeWidth) || 1) / 2;
      if (front) frontH = front.clientHeight;
      [ceiling, floor].forEach((p) => {
        p.win.style.display = p.depth >= 1 && ww >= 1 ? "" : "none";
        p.win.style.width = ww + "px";
        p.win.style.height = Math.max(1, p.depth) + "px";
        p.clone.style.left = "0px";
        p.clone.style.top = "0px";
        p.clone.style.width = ww + "px";
        p.clone.style.height = wh + "px";
      });
      if (flat) {
        flat.clone.style.left = "0px";
        flat.clone.style.top = "0px";
        flat.clone.style.width = ww + "px";
        flat.clone.style.height = wh + "px";
      }
      draw();
    }

    function follow() {
      const s = wall.scrollTop;
      ceiling.clone.style.transform = `translateY(${(ceiling.depth - s).toFixed(2)}px)`;
      floor.clone.style.transform = `translateY(${(-(s + wall.clientHeight)).toFixed(2)}px)`;
      if (flat) {
        const k = W / ww;
        flat.clone.style.transform = `translate(0px, ${(frontH - (s - ceiling.depth) * k).toFixed(2)}px) scale(${k.toFixed(5)})`;
        const up = s ? `translateY(${(-s * k).toFixed(2)}px)` : "";
        movers.forEach((el) => { el.style.transform = up; });
      }
    }

    function draw() {
      let dx = tiltX - cur.x * sway;
      let dy = tiltY - cur.y * sway;
      dx = clamp(dx, FRAME - wl, wr - FRAME);
      dy = clamp(dy, FRAME - wt, wb - FRAME);
      const x0 = wl + dx, x1 = W - wr + dx, y0 = wt + dy, y1 = H - wb + dy;
      const o = half, R = W - half, B = H - half;
      const pts = (...list) => list.map(([x, y]) => x.toFixed(1) + "," + y.toFixed(1)).join(" ");
      faces.back.setAttribute("points", pts([x0, y0], [x1, y0], [x1, y1], [x0, y1]));
      faces.ceiling.setAttribute("points", pts([o, o], [R, o], [x1, y0], [x0, y0]));
      faces.right.setAttribute("points", pts([R, o], [R, B], [x1, y1], [x1, y0]));
      faces.floor.setAttribute("points", pts([R, B], [o, B], [x0, y1], [x1, y1]));
      faces.left.setAttribute("points", pts([o, B], [o, o], [x0, y0], [x0, y1]));
      wall.style.transform = dx || dy ? `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)` : "";

      ceiling.win.style.transform = quadMatrix(ww, Math.max(1, ceiling.depth), [[0, 0], [W, 0], [x1, y0], [x0, y0]]);
      floor.win.style.transform = quadMatrix(ww, Math.max(1, floor.depth), [[x0, y1], [x1, y1], [W, H], [0, H]]);
      follow();
    }

    const smooth = media("(prefers-reduced-motion: reduce)") ? 1 : SCROLL_EASE;
    const maxScroll = () => Math.max(0, wall.scrollHeight - wall.clientHeight);
    let pos = 0;
    let goal = null;
    let glide = 0;
    let rafScroll = 0;
    let last = 0;

    function setScroll(y) {
      pos = clamp(y, 0, maxScroll());
      wall.scrollTop = pos;
      follow();
    }

    function scrollLoop(now) {
      rafScroll = 0;
      const dt = last ? Math.min(64, now - last) : 16.7;
      last = now;
      if (goal !== null) {
        goal = clamp(goal, 0, maxScroll());
        const k = 1 - Math.pow(1 - smooth, dt / 16.7);
        const next = Math.abs(goal - pos) < 0.5 ? goal : pos + (goal - pos) * k;
        setScroll(next);
        if (next === goal) goal = null;
      } else if (glide) {
        setScroll(pos + glide * dt);
        glide *= Math.pow(GLIDE, dt / 16.7);
        if (Math.abs(glide) < 0.01 || pos <= 0 || pos >= maxScroll()) glide = 0;
      }
      if (goal !== null || glide) rafScroll = requestAnimationFrame(scrollLoop);
      else last = 0;
    }
    const run = () => { if (!rafScroll) rafScroll = requestAnimationFrame(scrollLoop); };
    const busy = () => goal !== null || glide !== 0;

    wall.addEventListener("scroll", () => {
      if (!busy()) pos = wall.scrollTop;
      follow();
    }, { passive: true });

    const scrollAreas = front ? [stage, front] : [stage];
    const on = (type, fn, opts) => scrollAreas.forEach((el) => el.addEventListener(type, fn, opts));
    on("wheel", (e) => {
      if (e.ctrlKey || !e.deltaY) return;
      if (!busy()) pos = wall.scrollTop;
      glide = 0;
      const line = (parseFloat(getComputedStyle(wall).fontSize) || 16) * 1.25;
      const unit = e.deltaMode === 1 ? line : e.deltaMode === 2 ? wall.clientHeight : 1;
      const from = goal !== null ? goal : pos;
      const to = clamp(from + e.deltaY * unit, 0, maxScroll());
      if (to === from) return;
      e.preventDefault();
      goal = to;
      run();
    }, { passive: false });

    scrollAreas.forEach((el) => { el.style.touchAction = "pinch-zoom"; });
    wall.style.touchAction = "pinch-zoom";
    let touch = null;
    on("touchstart", (e) => {
      goal = null;
      glide = 0;
      if (e.touches.length !== 1) { touch = null; return; }
      pos = wall.scrollTop;
      const y = e.touches[0].clientY;
      touch = { start: y, y, time: e.timeStamp, v: 0, drag: false };
    }, { passive: true });
    on("touchmove", (e) => {
      if (!touch || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      if (!touch.drag) {
        if (Math.abs(y - touch.start) < 4) return;
        touch.drag = true;
      }
      if (e.cancelable) e.preventDefault();
      const d = touch.y - y;
      const dt = Math.max(1, e.timeStamp - touch.time);
      touch.v = 0.7 * (d / dt) + 0.3 * touch.v;
      touch.y = y;
      touch.time = e.timeStamp;
      const before = pos;
      setScroll(pos + d);
      const rest = d - (pos - before);
      if (rest) window.scrollBy(0, rest);
    }, { passive: false });
    on("touchend", (e) => {
      if (!touch) return;
      const t = touch;
      touch = null;
      if (!t.drag || e.timeStamp - t.time > 100 || Math.abs(t.v) < 0.05) return;
      glide = t.v;
      run();
    }, { passive: true });
    on("touchcancel", () => { touch = null; }, { passive: true });

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        measure();
      });
    };
    window.addEventListener("resize", schedule);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", schedule);
    new ResizeObserver(schedule).observe(stage);
    if (front) new ResizeObserver(schedule).observe(front);
    measure();

    let raf = 0;
    let base = null;

    function loop() {
      cur.x += (target.x - cur.x) * EASE;
      cur.y += (target.y - cur.y) * EASE;
      draw();
      const moving = Math.abs(target.x - cur.x) > 0.001 || Math.abs(target.y - cur.y) > 0.001;
      raf = moving ? requestAnimationFrame(loop) : 0;
    }

    function onOrientation(e) {
      if (e.beta == null || e.gamma == null) return;
      const angle = screen.orientation && typeof screen.orientation.angle === "number"
        ? screen.orientation.angle
        : Number(window.orientation) || 0;
      let x = e.gamma;
      let y = e.beta;
      if (angle === 90) { x = e.beta; y = -e.gamma; }
      else if (angle === 270 || angle === -90) { x = -e.beta; y = e.gamma; }
      else if (angle === 180) { x = -e.gamma; y = -e.beta; }
      if (!base) base = { x, y };
      base.x += (x - base.x) * RECENTER;
      base.y += (y - base.y) * RECENTER;
      target.x = clamp((x - base.x) / TILT_RANGE, -1, 1);
      target.y = clamp((y - base.y) / TILT_RANGE, -1, 1);
      if (!raf) raf = requestAnimationFrame(loop);
    }

    const DOE = window.DeviceOrientationEvent;
    if (DOE && media("(pointer: coarse)") && !media("(prefers-reduced-motion: reduce)")) {
      if (typeof DOE.requestPermission === "function") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "room-motion";
        button.textContent = "Raum bewegen";
        button.addEventListener("click", () => {
          DOE.requestPermission()
            .then((state) => {
              if (state === "granted") window.addEventListener("deviceorientation", onOrientation);
            })
            .catch(() => {})
            .finally(() => button.remove());
        });
        stage.appendChild(button);
      } else {
        window.addEventListener("deviceorientation", onOrientation);
      }
    }
  }

  function init() {
    document.querySelectorAll(".block-room").forEach(setupRoom);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();