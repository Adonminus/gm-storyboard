/**
 * GM Storyboard
 * A visual-novel-style synced slideshow for Foundry VTT v13
 * Requires: socketlib
 */

const MODULE_ID = "sand-storyboard";

/* ═══════════════════════════════════════════
   State
   ═══════════════════════════════════════════ */

let socket;
let editorApp = null;
let viewerEl = null;
let activeLayer = "a";
let _currentAudio = null;
let _typewriterTimer = null;
const TYPEWRITER_SPEED = 35;

const TRANSITIONS = {
  instant:          "Instant",
  crossfade:        "Crossfade",
  "fade-black":     "Fade to Black",
  "slide-left":     "Slide Left",
  "slide-right":    "Slide Right",
  "slide-up":       "Slide Up",
  "slide-down":     "Slide Down",
  "zoom-in":        "Zoom In",
  "zoom-out":       "Zoom Out",
  "sand-wipe":      "Sand Wipe",
  "sandstorm":      "Sandstorm",
  "golden-mist":    "Golden Mist",
  "desert-wind":    "Desert Wind",
  "ancient-reveal": "Ancient Reveal"
};

const OVERLAY_TRANSITIONS = ["sand-wipe", "sandstorm", "golden-mist", "desert-wind", "ancient-reveal"];

const KEN_BURNS_OPTIONS = {
  none:        "None",
  "zoom-in":   "Slow Zoom In",
  "zoom-out":  "Slow Zoom Out",
  "pan-left":  "Pan Left",
  "pan-right": "Pan Right",
  random:      "Random"
};

const AMBIENT_PARTICLE_OPTIONS = {
  none:      "None",
  snow:      "Snow",
  rain:      "Rain",
  embers:    "Embers",
  dust:      "Dust",
  fireflies: "Fireflies"
};

let _ambientRaf = null;
let _ambientParticles = [];

const presentation = {
  active: false,
  preview: false,
  slides: [],
  index: 0,
  captionIndex: 0
};

/* ═══════════════════════════════════════════
   Hooks
   ═══════════════════════════════════════════ */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "decks", {
    name: "Storyboard Decks",
    hint: "All saved storyboard decks.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
});

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("showSlide", _onRemoteShowSlide);
  socket.register("showCaption", _onRemoteShowCaption);
  socket.register("endShow", _onRemoteEndShow);
  socket.register("getPresentation", _onGetPresentation);
});

Hooks.once("ready", () => {
  if (!game.modules.get("socketlib")?.active) {
    ui.notifications.error("GM Storyboard requires the socketlib module. Please enable it.");
  }
  if (game.user.isGM) {
    game.sandStoryboard = {
      open: () => {
        if (!editorApp) editorApp = new StoryboardEditor();
        editorApp.render(true);
      }
    };
  }
  // Late-join sync: if a presentation is running, catch up
  if (!game.user.isGM && socket) {
    socket.executeAsGM("getPresentation").then(data => {
      if (data) {
        _migrateSlide(data.slide);
        _onRemoteShowSlide(data);
      }
    }).catch(() => {});
  }
});

Hooks.on("getSceneControlButtons", controls => {
  if (!game.user.isGM) return;
  const group = controls.notes ?? controls.journal;
  if (!group?.tools) return;
  group.tools["sand-storyboard"] = {
    name: "sand-storyboard",
    title: "GM Storyboard",
    icon: "fas fa-film",
    order: 100,
    button: true,
    visible: true,
    onChange: () => {
      if (!editorApp) editorApp = new StoryboardEditor();
      editorApp.render(true);
    }
  };
});

/* ═══════════════════════════════════════════
   Socket Handlers
   ═══════════════════════════════════════════ */

function _onRemoteShowSlide(data) {
  _migrateSlide(data.slide);
  _renderViewer(data.slide, data.index, data.total, data.captionIndex || 0);
}

function _onRemoteShowCaption(data) {
  _renderCaption(data);
}

function _onRemoteEndShow() {
  _destroyViewer();
}

function _onGetPresentation() {
  if (!presentation.active || presentation.preview) return null;
  const slide = presentation.slides[presentation.index];
  return {
    slide,
    index: presentation.index,
    total: presentation.slides.length,
    captionIndex: presentation.captionIndex,
    totalCaptions: (slide.captions || []).length
  };
}

/* ═══════════════════════════════════════════
   Presentation Controller (GM only)
   ═══════════════════════════════════════════ */

function startPresentation(slides, preview = false) {
  if (slides.length === 0) return;
  presentation.active = true;
  presentation.preview = preview;
  presentation.slides = slides.map(s => _migrateSlide(s));
  presentation.index = 0;
  presentation.captionIndex = 0;
  _broadcastSlide();
}

function goToSlide(index) {
  if (!presentation.active) return;
  if (index < 0 || index >= presentation.slides.length) return;
  presentation.index = index;
  presentation.captionIndex = 0;
  _broadcastSlide();
}

function nextStep() {
  if (!presentation.active) return;
  const slide = presentation.slides[presentation.index];
  const captions = slide.captions || [];
  if (presentation.captionIndex < captions.length - 1) {
    presentation.captionIndex++;
    _broadcastCaption();
  } else {
    if (presentation.index < presentation.slides.length - 1) {
      presentation.index++;
      presentation.captionIndex = 0;
      _broadcastSlide();
    }
  }
}

function prevStep() {
  if (!presentation.active) return;
  if (presentation.captionIndex > 0) {
    presentation.captionIndex--;
    _broadcastCaption();
  } else {
    if (presentation.index > 0) {
      presentation.index--;
      const prev = presentation.slides[presentation.index];
      const captions = prev.captions || [];
      presentation.captionIndex = Math.max(captions.length - 1, 0);
      _broadcastSlide();
    }
  }
}

function endPresentation() {
  if (!presentation.active) return;
  presentation.active = false;
  _destroyViewer();
  if (!presentation.preview) socket.executeForOthers("endShow");
}

function _broadcastSlide() {
  const slide = presentation.slides[presentation.index];
  const data = {
    slide,
    index: presentation.index,
    total: presentation.slides.length,
    captionIndex: presentation.captionIndex,
    totalCaptions: (slide.captions || []).length
  };
  _renderViewer(slide, presentation.index, presentation.slides.length, presentation.captionIndex);
  if (!presentation.preview) socket.executeForOthers("showSlide", data);
}

function _broadcastCaption() {
  const slide = presentation.slides[presentation.index];
  const captions = slide.captions || [];
  const cap = captions[presentation.captionIndex] || { speaker: "", text: "" };
  const data = {
    speaker: cap.speaker,
    text: cap.text,
    captionIndex: presentation.captionIndex,
    totalCaptions: captions.length,
    typewriter: !!slide.typewriter,
    slideIndex: presentation.index,
    totalSlides: presentation.slides.length
  };
  _renderCaption(data);
  if (!presentation.preview) socket.executeForOthers("showCaption", data);
}

/* ═══════════════════════════════════════════
   Sand Particle Transitions
   ═══════════════════════════════════════════ */

const SAND_COLORS = [
  [212, 184, 122], [194, 154, 80], [160, 120, 50],
  [240, 192, 64], [232, 213, 168]
];

let _sandRaf = null;

function _runSandTransition(overlay, type, onPeak, onDone) {
  if (_sandRaf) { cancelAnimationFrame(_sandRaf); _sandRaf = null; }

  let canvas = overlay.querySelector("canvas");
  if (!canvas) { canvas = document.createElement("canvas"); overlay.appendChild(canvas); }
  const ctx = canvas.getContext("2d");
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  overlay.style.opacity = "1";

  const DUR = type === "desert-wind" ? 2400 : 1400;
  const PEAK = 0.42, PI2 = Math.PI * 2;
  let peaked = false, start = null;
  const bell = t => Math.pow(Math.sin(t * Math.PI), 1.3);

  /* ── Spawn particles ── */
  const particles = [];
  const N = { "sand-wipe": 500, sandstorm: 550, "golden-mist": 300,
              "desert-wind": 450, "ancient-reveal": 350 }[type] || 400;

  for (let i = 0; i < N; i++) {
    const col = type === "golden-mist"
      ? (Math.random() > 0.3 ? SAND_COLORS[3] : SAND_COLORS[0])
      : type === "ancient-reveal" && Math.random() > 0.45
        ? [60, 40, 20]
        : SAND_COLORS[Math.floor(Math.random() * SAND_COLORS.length)];

    const p = { c: col, a: 0.3 + Math.random() * 0.7, s: 1 + Math.random() * 4, x: 0, y: 0 };

    if (type === "sand-wipe") {
      p.x = Math.random() * W * 0.5 - W * 0.25;
      p.y = Math.random() * H;
      p.vx = 3 + Math.random() * 5;
      p.vy = (Math.random() - 0.5) * 2;
      p.s = 1.5 + Math.random() * 3.5;
    } else if (type === "sandstorm") {
      p.x = Math.random() * W;
      p.y = Math.random() * H;
      p.vx = (Math.random() - 0.5) * 5;
      p.vy = (Math.random() - 0.5) * 4;
      p.freq = 1 + Math.random() * 3;
      p.phase = Math.random() * PI2;
    } else if (type === "golden-mist") {
      const ang = Math.random() * PI2;
      const spd = 0.3 + Math.random() * 1.8;
      p.x = W / 2 + (Math.random() - 0.5) * 50;
      p.y = H / 2 + (Math.random() - 0.5) * 50;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.s = 3 + Math.random() * 6;
    } else if (type === "desert-wind") {
      p.x = W + Math.random() * W * 0.5;
      p.y = -Math.random() * H * 0.4;
      p.vx = -(5 + Math.random() * 7);
      p.vy = 1.5 + Math.random() * 3.5;
      p.s = 1 + Math.random() * 2;
      p.streak = 6 + Math.random() * 14;
    } else if (type === "ancient-reveal") {
      const ang = Math.random() * PI2;
      const dist = Math.max(W, H) * (0.5 + Math.random() * 0.5);
      p.ox = W / 2 + Math.cos(ang) * dist;
      p.oy = H / 2 + Math.sin(ang) * dist;
      p.tx = W / 2 + (Math.random() - 0.5) * 80;
      p.ty = H / 2 + (Math.random() - 0.5) * 80;
      p.x = p.ox; p.y = p.oy;
      p.s = 1.5 + Math.random() * 3;
    }
    particles.push(p);
  }

  /* ── Animation loop ── */
  function frame(ts) {
    if (!start) start = ts;
    const prog = Math.min((ts - start) / DUR, 1);
    if (prog >= PEAK && !peaked) { peaked = true; onPeak(); }
    if (prog >= 1) {
      overlay.style.opacity = "0";
      ctx.clearRect(0, 0, W, H);
      _sandRaf = null;
      onDone();
      return;
    }

    const d = bell(prog);
    ctx.clearRect(0, 0, W, H);

    /* ── Haze layer ── */
    if (type === "sand-wipe") {
      ctx.fillStyle = `rgba(194,154,80,${0.2 * d})`;
      ctx.fillRect(0, 0, W, H);
      const fx = (prog * 2 - 0.4) * W;
      const g = ctx.createLinearGradient(fx - W * 0.6, 0, fx + W * 0.3, 0);
      g.addColorStop(0, "rgba(194,154,80,0)");
      g.addColorStop(0.25, `rgba(194,154,80,${0.6 * d})`);
      g.addColorStop(0.5, `rgba(210,170,90,${0.8 * d})`);
      g.addColorStop(0.75, `rgba(194,154,80,${0.55 * d})`);
      g.addColorStop(1, "rgba(194,154,80,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (type === "sandstorm") {
      ctx.fillStyle = `rgba(194,154,80,${0.5 * d})`;
      ctx.fillRect(0, 0, W, H);
    } else if (type === "golden-mist") {
      const r = Math.max(W, H) * (0.15 + prog * 0.65);
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r);
      g.addColorStop(0, `rgba(240,192,64,${0.5 * d})`);
      g.addColorStop(0.6, `rgba(210,170,90,${0.25 * d})`);
      g.addColorStop(1, "rgba(180,140,60,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (type === "desert-wind") {
      ctx.fillStyle = `rgba(194,154,80,${0.15 * d})`;
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(W, 0, 0, H);
      g.addColorStop(0, `rgba(194,154,80,${0.35 * d})`);
      g.addColorStop(0.5, `rgba(210,170,90,${0.55 * d})`);
      g.addColorStop(1, `rgba(194,154,80,${0.2 * d})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (type === "ancient-reveal") {
      const maxR = Math.max(W, H) * 0.85;
      const r = maxR * Math.max(1 - d * 1.2, 0);
      const g = ctx.createRadialGradient(W / 2, H / 2, r, W / 2, H / 2, maxR);
      g.addColorStop(0, "rgba(30,20,10,0)");
      g.addColorStop(0.15, `rgba(30,20,10,${0.9 * d})`);
      g.addColorStop(1, `rgba(30,20,10,${0.95 * d})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    /* ── Particles ── */
    if (type === "golden-mist") ctx.globalCompositeOperation = "lighter";

    for (const p of particles) {
      // Tick
      if (type === "sand-wipe") {
        p.x += p.vx; p.y += p.vy;
        if (p.x > W + 40) { p.x = -30; p.y = Math.random() * H; }
      } else if (type === "sandstorm") {
        p.x += p.vx + Math.sin(prog * p.freq * 12 + p.phase) * 2;
        p.y += p.vy + Math.cos(prog * p.freq * 10 + p.phase) * 1.5;
        if (p.x < -30) p.x += W + 60;
        if (p.x > W + 30) p.x -= W + 60;
        if (p.y < -30) p.y += H + 60;
        if (p.y > H + 30) p.y -= H + 60;
      } else if (type === "golden-mist") {
        p.x += p.vx * (0.5 + prog * 1.5);
        p.y += p.vy * (0.5 + prog * 1.5);
      } else if (type === "desert-wind") {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -70 || p.y > H + 70) {
          p.x = W + Math.random() * W * 0.3;
          p.y = -Math.random() * H * 0.4;
        }
      } else if (type === "ancient-reveal") {
        const interp = prog < 0.5 ? prog * 2 : 2 - prog * 2;
        const ease = interp < 0.5 ? 2 * interp * interp : 1 - Math.pow(-2 * interp + 2, 2) / 2;
        p.x = p.ox + (p.tx - p.ox) * ease;
        p.y = p.oy + (p.ty - p.oy) * ease;
      }

      // Draw
      const alpha = p.a * d;
      if (alpha < 0.01) continue;
      const [r, g, b] = p.c;

      if (type === "desert-wind") {
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = p.s * 0.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.streak, p.y - p.streak * 0.4);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, PI2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fill();
      }
    }

    if (type === "golden-mist") ctx.globalCompositeOperation = "source-over";

    _sandRaf = requestAnimationFrame(frame);
  }

  _sandRaf = requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════
   Ambient Particles
   ═══════════════════════════════════════════ */

function _stopAmbientParticles() {
  if (_ambientRaf) { cancelAnimationFrame(_ambientRaf); _ambientRaf = null; }
  _ambientParticles = [];
  if (viewerEl) {
    const c = viewerEl.querySelector(".sb-ambient-canvas");
    if (c) c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }
}

function _startAmbientParticles(type) {
  _stopAmbientParticles();
  if (!type || type === "none" || !viewerEl) return;

  const canvas = viewerEl.querySelector(".sb-ambient-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width = window.innerWidth;
  const H = canvas.height = window.innerHeight;
  const PI2 = Math.PI * 2;
  const N = { snow: 150, rain: 200, embers: 120, dust: 140, fireflies: 80 }[type] || 150;

  for (let i = 0; i < N; i++) {
    const p = { x: Math.random() * W, y: Math.random() * H };
    if (type === "snow") {
      p.r = 1.5 + Math.random() * 3;
      p.vy = 0.3 + Math.random() * 1.2;
      p.vx = (Math.random() - 0.5) * 0.5;
      p.drift = Math.random() * PI2;
      p.a = 0.4 + Math.random() * 0.5;
    } else if (type === "rain") {
      p.len = 8 + Math.random() * 16;
      p.vy = 6 + Math.random() * 10;
      p.vx = -1 - Math.random() * 2;
      p.a = 0.15 + Math.random() * 0.3;
    } else if (type === "embers") {
      p.r = 1 + Math.random() * 2.5;
      p.vy = -(0.5 + Math.random() * 1.5);
      p.vx = (Math.random() - 0.5) * 0.8;
      p.drift = Math.random() * PI2;
      p.a = 0.5 + Math.random() * 0.5;
      p.life = Math.random();
    } else if (type === "dust") {
      p.r = 1 + Math.random() * 2;
      p.vx = (Math.random() - 0.5) * 0.4;
      p.vy = (Math.random() - 0.5) * 0.3;
      p.drift = Math.random() * PI2;
      p.a = 0.2 + Math.random() * 0.35;
    } else if (type === "fireflies") {
      p.r = 2 + Math.random() * 2;
      p.angle = Math.random() * PI2;
      p.speed = 0.2 + Math.random() * 0.5;
      p.pulse = Math.random() * PI2;
      p.a = 0.4 + Math.random() * 0.6;
    }
    _ambientParticles.push(p);
  }

  let lastTime = 0;
  function frame(ts) {
    const dt = lastTime ? (ts - lastTime) / 16.67 : 1;
    lastTime = ts;
    ctx.clearRect(0, 0, W, H);

    for (const p of _ambientParticles) {
      if (type === "snow") {
        p.drift += 0.01 * dt;
        p.x += (p.vx + Math.sin(p.drift) * 0.5) * dt;
        p.y += p.vy * dt;
        if (p.y > H + 10) { p.y = -10; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, PI2);
        ctx.fillStyle = `rgba(255,255,255,${p.a})`;
        ctx.fill();
      } else if (type === "rain") {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > H + 20) { p.y = -20; p.x = Math.random() * W; }
        ctx.strokeStyle = `rgba(170,190,210,${p.a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 0.5, p.y + p.len);
        ctx.stroke();
      } else if (type === "embers") {
        p.drift += 0.015 * dt;
        p.x += (p.vx + Math.sin(p.drift) * 0.6) * dt;
        p.y += p.vy * dt;
        p.life += 0.005 * dt;
        if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; p.life = Math.random(); }
        const br = 0.5 + Math.sin(p.life * 6) * 0.5;
        const r = 220 + Math.floor(br * 35);
        const g = 80 + Math.floor(br * 60);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, PI2);
        ctx.fillStyle = `rgba(${r},${g},20,${p.a * br})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 2.5, 0, PI2);
        ctx.fillStyle = `rgba(${r},${g},20,${p.a * br * 0.15})`;
        ctx.fill();
      } else if (type === "dust") {
        p.drift += 0.008 * dt;
        p.x += (p.vx + Math.sin(p.drift) * 0.2) * dt;
        p.y += (p.vy + Math.cos(p.drift * 0.7) * 0.15) * dt;
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, PI2);
        ctx.fillStyle = `rgba(210,190,140,${p.a})`;
        ctx.fill();
      } else if (type === "fireflies") {
        p.pulse += 0.03 * dt;
        p.angle += (Math.random() - 0.5) * 0.15 * dt;
        p.x += Math.cos(p.angle) * p.speed * dt;
        p.y += Math.sin(p.angle) * p.speed * dt;
        if (p.x < -20) p.x = W + 20;
        if (p.x > W + 20) p.x = -20;
        if (p.y < -20) p.y = H + 20;
        if (p.y > H + 20) p.y = -20;
        const glow = 0.3 + Math.sin(p.pulse) * 0.7;
        const alpha = p.a * Math.max(glow, 0);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 0.5, 0, PI2);
        ctx.fillStyle = `rgba(200,240,80,${alpha})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, PI2);
        ctx.fillStyle = `rgba(180,220,60,${alpha * 0.12})`;
        ctx.fill();
      }
    }

    _ambientRaf = requestAnimationFrame(frame);
  }
  _ambientRaf = requestAnimationFrame(frame);
}

/* ═══════════════════════════════════════════
   Viewer
   ═══════════════════════════════════════════ */

function _createViewer() {
  viewerEl = document.createElement("div");
  viewerEl.id = "storyboard-viewer";
  viewerEl.innerHTML = `
    <div class="sb-blackout"></div>
    <div class="sb-transition-overlay"></div>
    <div class="sb-slide-layer sb-layer-a"></div>
    <div class="sb-slide-layer sb-layer-b"></div>
    <canvas class="sb-ambient-canvas"></canvas>
    <div class="sb-caption-bar">
      <span class="sb-speaker"></span>
      <span class="sb-caption-text"></span>
    </div>
    <div class="sb-sidebar-area">
      <button class="sb-sidebar-toggle" title="Toggle sidebar"><i class="fas fa-chevron-left"></i></button>
    </div>
    ${game.user.isGM ? `
    <div class="sb-progress-dots"></div>
    <div class="sb-caption-counter"></div>
    <div class="sb-gm-controls">
      <button class="sb-prev-btn" title="Previous step"><i class="fas fa-chevron-left"></i> Prev</button>
      <button class="sb-end-btn" title="End slideshow"><i class="fas fa-times"></i> End</button>
      <button class="sb-next-btn" title="Next step">Next <i class="fas fa-chevron-right"></i></button>
    </div>` : ""}
  `;
  document.body.appendChild(viewerEl);
  document.body.classList.add("sb-presenting");

  viewerEl.querySelector(".sb-sidebar-toggle").addEventListener("click", () => {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    const area = viewerEl.querySelector(".sb-sidebar-area");
    const isInViewer = area.contains(sidebar);
    if (isInViewer) {
      sidebar.classList.remove("sb-in-viewer");
      document.getElementById("ui-right")?.appendChild(sidebar);
      document.body.classList.remove("sb-sidebar-visible");
    } else {
      area.appendChild(sidebar);
      sidebar.classList.add("sb-in-viewer");
      document.body.classList.add("sb-sidebar-visible");
    }
  });

  if (game.user.isGM) {
    viewerEl.querySelector(".sb-prev-btn").addEventListener("click", prevStep);
    viewerEl.querySelector(".sb-next-btn").addEventListener("click", nextStep);
    viewerEl.querySelector(".sb-end-btn").addEventListener("click", endPresentation);
    document.addEventListener("keydown", _viewerKeyHandler);
  }
  activeLayer = "a";
}

function _setLayerContent(layer, slide) {
  layer.replaceChildren();
  if (slide.type === "image") {
    const img = document.createElement("img");
    img.src = slide.content;
    img.alt = "slide";
    let kb = slide.kenBurns || "none";
    if (kb === "random") {
      const choices = ["zoom-in", "zoom-out", "pan-left", "pan-right"];
      kb = choices[Math.floor(Math.random() * choices.length)];
    }
    if (kb !== "none") img.classList.add(`sb-kb-${kb}`);
    layer.appendChild(img);
  } else {
    const iframe = document.createElement("iframe");
    iframe.sandbox = "allow-scripts allow-same-origin";
    iframe.srcdoc = slide.content;
    layer.appendChild(iframe);
  }
}

const ALL_LAYER_CLASSES = ["active", "enter-crossfade",
  "enter-slide-left", "enter-slide-right", "enter-slide-up", "enter-slide-down",
  "enter-zoom-in", "enter-zoom-out"];

function _renderViewer(slide, index, total, captionIndex = 0) {
  if (!viewerEl) _createViewer();

  const targetSel = activeLayer === "a" ? ".sb-layer-a" : ".sb-layer-b";
  const otherSel  = activeLayer === "a" ? ".sb-layer-b" : ".sb-layer-a";
  const target = viewerEl.querySelector(targetSel);
  const other  = viewerEl.querySelector(otherSel);
  const blackout = viewerEl.querySelector(".sb-blackout");

  _setLayerContent(target, slide);

  // Reset
  target.classList.remove(...ALL_LAYER_CLASSES);
  target.style.transition = "";
  target.style.zIndex = "";
  other.style.transition = "";

  const t = slide.transition || "crossfade";
  const dur = 500;
  const overlay = viewerEl.querySelector(".sb-transition-overlay");

  if (OVERLAY_TRANSITIONS.includes(t)) {
    _runSandTransition(overlay, t, () => {
      other.classList.remove(...ALL_LAYER_CLASSES);
      other.style.zIndex = "";
      target.classList.add("active");
    }, () => {});
  } else if (t === "instant") {
    target.classList.add("active");
    other.classList.remove(...ALL_LAYER_CLASSES);
    other.style.zIndex = "";
  } else if (t === "crossfade") {
    target.style.zIndex = "2";
    other.style.zIndex = "1";
    target.classList.add("enter-crossfade");
    void target.offsetWidth;
    target.classList.add("active");
    setTimeout(() => {
      other.classList.remove(...ALL_LAYER_CLASSES);
      other.style.zIndex = "";
      target.style.zIndex = "";
      target.classList.remove("enter-crossfade");
    }, dur + 50);
  } else if (t === "fade-black") {
    blackout.style.transition = `opacity ${dur / 2}ms ease`;
    blackout.classList.add("active");
    setTimeout(() => {
      other.classList.remove(...ALL_LAYER_CLASSES);
      other.style.zIndex = "";
      target.classList.add("active");
      blackout.style.transition = `opacity ${dur / 2}ms ease`;
      blackout.classList.remove("active");
    }, dur / 2 + 30);
  } else if (t.startsWith("slide-") || t.startsWith("zoom-")) {
    target.style.zIndex = "2";
    other.style.zIndex = "1";
    target.classList.add(`enter-${t}`);
    void target.offsetWidth;
    target.classList.add("active");
    target.classList.remove(`enter-${t}`);
    setTimeout(() => {
      other.classList.remove(...ALL_LAYER_CLASSES);
      other.style.zIndex = "";
      target.style.zIndex = "";
    }, dur + 50);
  }

  activeLayer = activeLayer === "a" ? "b" : "a";

  // Caption (with typewriter support)
  if (_typewriterTimer) { clearInterval(_typewriterTimer); _typewriterTimer = null; }

  const bar = viewerEl.querySelector(".sb-caption-bar");
  const speakerEl = bar.querySelector(".sb-speaker");
  const captionEl = bar.querySelector(".sb-caption-text");
  const captions = slide.captions || [];
  const cap = captions[captionIndex];
  if (cap && (cap.text || cap.speaker)) {
    bar.classList.add("visible");
    speakerEl.textContent = cap.speaker || "";
    speakerEl.style.display = cap.speaker ? "" : "none";
    const fullCaption = cap.text || "";
    if (slide.typewriter && fullCaption.length > 0) {
      captionEl.textContent = "";
      let charIdx = 0;
      _typewriterTimer = setInterval(() => {
        charIdx++;
        captionEl.textContent = fullCaption.substring(0, charIdx);
        if (charIdx >= fullCaption.length) {
          clearInterval(_typewriterTimer);
          _typewriterTimer = null;
        }
      }, TYPEWRITER_SPEED);
    } else {
      captionEl.textContent = fullCaption;
    }
  } else {
    bar.classList.remove("visible");
  }

  // Audio
  if (!slide.audioContinue) {
    if (_currentAudio) { _currentAudio.pause(); _currentAudio.currentTime = 0; _currentAudio = null; }
    if (slide.audio) {
      _currentAudio = new Audio(slide.audio);
      _currentAudio.volume = 0.8;
      _currentAudio.loop = true;
      _currentAudio.play().catch(() => {});
    }
  }

  // Ambient particles
  _startAmbientParticles(slide.ambientParticles || "none");

  // Progress UI
  _updateProgressUI(index, total, captionIndex, captions.length);
}

function _renderCaption(data) {
  if (!viewerEl) return;

  if (_typewriterTimer) { clearInterval(_typewriterTimer); _typewriterTimer = null; }

  const bar = viewerEl.querySelector(".sb-caption-bar");
  const speakerEl = bar.querySelector(".sb-speaker");
  const captionEl = bar.querySelector(".sb-caption-text");

  if (data.text || data.speaker) {
    bar.classList.add("visible");
    speakerEl.textContent = data.speaker || "";
    speakerEl.style.display = data.speaker ? "" : "none";
    const fullCaption = data.text || "";
    if (data.typewriter && fullCaption.length > 0) {
      captionEl.textContent = "";
      let charIdx = 0;
      _typewriterTimer = setInterval(() => {
        charIdx++;
        captionEl.textContent = fullCaption.substring(0, charIdx);
        if (charIdx >= fullCaption.length) {
          clearInterval(_typewriterTimer);
          _typewriterTimer = null;
        }
      }, TYPEWRITER_SPEED);
    } else {
      captionEl.textContent = fullCaption;
    }
  } else {
    bar.classList.remove("visible");
  }

  _updateProgressUI(data.slideIndex, data.totalSlides, data.captionIndex, data.totalCaptions);
}

function _updateProgressUI(slideIndex, totalSlides, captionIndex, totalCaptions) {
  if (!viewerEl) return;

  // Progress dots (GM only)
  const dots = viewerEl.querySelector(".sb-progress-dots");
  if (dots) {
    dots.innerHTML = Array.from({ length: totalSlides }, (_, i) =>
      `<span class="sb-dot${i === slideIndex ? " active" : ""}"></span>`
    ).join("");
  }

  // Caption counter (GM only)
  const counter = viewerEl.querySelector(".sb-caption-counter");
  if (counter) {
    if (totalCaptions > 1) {
      counter.textContent = `Caption ${captionIndex + 1}/${totalCaptions}`;
      counter.style.display = "";
    } else {
      counter.textContent = "";
      counter.style.display = "none";
    }
  }
}

function _destroyViewer() {
  if (game.user.isGM) document.removeEventListener("keydown", _viewerKeyHandler);
  if (_typewriterTimer) { clearInterval(_typewriterTimer); _typewriterTimer = null; }
  if (_currentAudio) { _currentAudio.pause(); _currentAudio.currentTime = 0; _currentAudio = null; }
  _stopAmbientParticles();
  // Restore sidebar to its original parent before removing the viewer
  if (viewerEl) {
    const sidebar = viewerEl.querySelector("#sidebar");
    if (sidebar) {
      sidebar.classList.remove("sb-in-viewer");
      document.getElementById("ui-right")?.appendChild(sidebar);
    }
  }
  document.body.classList.remove("sb-sidebar-visible");
  document.body.classList.remove("sb-presenting");
  if (viewerEl) { viewerEl.remove(); viewerEl = null; }
}

function _viewerKeyHandler(e) {
  if (!presentation.active) return;
  switch (e.key) {
    case "ArrowRight": case "ArrowDown":
      e.preventDefault(); nextStep(); break;
    case "ArrowLeft": case "ArrowUp":
      e.preventDefault(); prevStep(); break;
    case "Escape":
      e.preventDefault(); endPresentation(); break;
  }
}

/* ═══════════════════════════════════════════
   Utility
   ═══════════════════════════════════════════ */

function _escapeHtml(str) {
  if (!str) return "";
  const el = document.createElement("span");
  el.textContent = str;
  return el.innerHTML;
}

function _migrateSlide(slide) {
  if (!slide.captions) {
    slide.captions = [];
    if (slide.caption || slide.speaker) {
      slide.captions.push({ speaker: slide.speaker || "", text: slide.caption || "" });
    }
    delete slide.caption;
    delete slide.speaker;
  }
  return slide;
}

/* ═══════════════════════════════════════════
   Deck Persistence Helpers
   ═══════════════════════════════════════════ */

function _getDecks() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, "decks") || {});
}

async function _setDecks(decks) {
  await game.settings.set(MODULE_ID, "decks", decks);
}

/* ═══════════════════════════════════════════
   Editor Application (GM only)
   ═══════════════════════════════════════════ */

class StoryboardEditor extends Application {

  constructor() {
    super();
    this.currentDeckId = null;
    this.slides = [];
    this._expandedCaptions = new Set();
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "storyboard-editor",
      title: "GM Storyboard",
      classes: ["storyboard-editor"],
      width: 540,
      height: 660,
      resizable: true
    });
  }

  /* ── Rendering ── */

  async _renderInner() {
    await this._ensureDeck();
    const wrapper = document.createElement("div");
    wrapper.className = "sb-editor-body";
    wrapper.innerHTML = this._buildHTML();
    return $(wrapper);
  }

  async close(options) {
    await this._saveCurrentDeck();
    return super.close(options);
  }

  /* ── Deck Management ── */

  async _ensureDeck() {
    const decks = _getDecks();
    const ids = Object.keys(decks);

    // If our current deck still exists, keep working with in-memory slides
    if (this.currentDeckId && decks[this.currentDeckId]) {
      this.slides.forEach(s => _migrateSlide(s));
      return;
    }

    // Otherwise pick the first deck, or create one
    if (ids.length > 0) {
      this.currentDeckId = ids[0];
      this.slides = (decks[ids[0]].slides || []).map(s => _migrateSlide(s));
    } else {
      const id = foundry.utils.randomID();
      decks[id] = { name: "Untitled Storyboard", slides: [] };
      await _setDecks(decks);
      this.currentDeckId = id;
      this.slides = [];
    }
  }

  async _saveCurrentDeck() {
    if (!this.currentDeckId) return;
    this._syncFields();
    const decks = _getDecks();
    if (decks[this.currentDeckId]) {
      decks[this.currentDeckId].slides = foundry.utils.deepClone(this.slides);
      await _setDecks(decks);
    }
  }

  async _switchDeck(id) {
    await this._saveCurrentDeck();
    this.currentDeckId = id;
    const decks = _getDecks();
    this.slides = (decks[id]?.slides || []).map(s => _migrateSlide(s));
    this.render(true);
  }

  async _createDeck() {
    await this._saveCurrentDeck();
    const id = foundry.utils.randomID();
    const decks = _getDecks();
    decks[id] = { name: "Untitled Storyboard", slides: [] };
    await _setDecks(decks);
    this.currentDeckId = id;
    this.slides = [];
    this.render(true);
  }

  _renameDeck() {
    if (!this.currentDeckId) return;
    const decks = _getDecks();
    const deck = decks[this.currentDeckId];
    if (!deck) return;

    new Dialog({
      title: "Rename Storyboard",
      content: `<div style="margin:8px 0">
        <label style="font-size:0.85em;color:#999">Name</label>
        <input type="text" id="sb-rename" value="${_escapeHtml(deck.name)}"
          style="width:100%;margin-top:4px;padding:6px;background:#1a1a1a;border:1px solid #444;border-radius:3px;color:#ddd;" />
      </div>`,
      buttons: {
        ok: {
          icon: '<i class="fas fa-check"></i>',
          label: "Save",
          callback: async html => {
            const name = html.find("#sb-rename").val().trim();
            if (!name) return;
            deck.name = name;
            await _setDecks(decks);
            this.render(true);
          }
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
      },
      default: "ok"
    }).render(true);
  }

  _deleteDeck() {
    if (!this.currentDeckId) return;
    const decks = _getDecks();
    const name = decks[this.currentDeckId]?.name || "this storyboard";

    Dialog.confirm({
      title: "Delete Storyboard",
      content: `<p>Delete <strong>${_escapeHtml(name)}</strong>? This cannot be undone.</p>`,
      yes: async () => {
        delete decks[this.currentDeckId];
        await _setDecks(decks);
        const ids = Object.keys(decks);
        if (ids.length > 0) {
          this.currentDeckId = ids[0];
          this.slides = decks[ids[0]].slides || [];
        } else {
          this.currentDeckId = null;
          this.slides = [];
        }
        this.render(true);
      }
    });
  }

  /* ── HTML builders ── */

  _buildHTML() {
    const decks = _getDecks();
    const deckOptions = Object.entries(decks).map(([id, d]) =>
      `<option value="${id}" ${id === this.currentDeckId ? "selected" : ""}>${_escapeHtml(d.name)}</option>`
    ).join("");

    const items = this.slides.map((s, i) => this._buildSlideItem(s, i)).join("");

    return `
      <div class="sb-deck-bar">
        <select class="sb-deck-select">${deckOptions}</select>
        <button class="sb-deck-new" title="New storyboard"><i class="fas fa-plus"></i></button>
        <button class="sb-deck-rename" title="Rename"><i class="fas fa-pen"></i></button>
        <button class="sb-deck-delete" title="Delete"><i class="fas fa-trash"></i></button>
      </div>
      <div class="sb-toolbar sb-toolbar-top">
        <button class="sb-add-image"><i class="fas fa-image"></i> Image Slide</button>
        <button class="sb-add-html"><i class="fas fa-code"></i> HTML Slide</button>
      </div>
      <ol class="sb-slide-list">
        ${items || '<li class="sb-empty">No slides yet — add one above.</li>'}
      </ol>
      <div class="sb-toolbar sb-toolbar-bottom">
        <button class="sb-present"><i class="fas fa-play"></i> Present to Players</button>
        <button class="sb-preview"><i class="fas fa-eye"></i> Preview</button>
      </div>`;
  }

  _buildSlideItem(slide, idx) {
    _migrateSlide(slide);
    const isImage = slide.type === "image";
    const transitionOpts = Object.entries(TRANSITIONS).map(([val, label]) =>
      `<option value="${val}" ${slide.transition === val ? "selected" : ""}>${label}</option>`
    ).join("");
    const kenBurnsOpts = Object.entries(KEN_BURNS_OPTIONS).map(([val, label]) =>
      `<option value="${val}" ${(slide.kenBurns || "none") === val ? "selected" : ""}>${label}</option>`
    ).join("");
    const particleOpts = Object.entries(AMBIENT_PARTICLE_OPTIONS).map(([val, label]) =>
      `<option value="${val}" ${(slide.ambientParticles || "none") === val ? "selected" : ""}>${label}</option>`
    ).join("");

    const contentField = isImage
      ? `<div class="sb-image-field">
           <input type="text" class="sb-field-content" data-idx="${idx}"
             value="${_escapeHtml(slide.content)}"
             placeholder="Click folder icon to browse..." />
           <button class="sb-browse-btn" data-idx="${idx}" title="Browse files">
             <i class="fas fa-folder-open"></i>
           </button>
         </div>`
      : `<textarea class="sb-field-content" data-idx="${idx}" rows="3"
           placeholder="&lt;html&gt;...&lt;/html&gt;">${_escapeHtml(slide.content)}</textarea>`;

    const thumbnailHtml = isImage
      ? `<div class="sb-thumbnail-preview" data-idx="${idx}"
           style="${slide.content ? "" : "display:none"}">
           <img src="${_escapeHtml(slide.content)}" alt="preview" />
         </div>`
      : "";

    return `
      <li class="sb-slide-item" data-idx="${idx}" draggable="true">
        <div class="sb-slide-header">
          <span class="sb-drag-handle" title="Drag to reorder"><i class="fas fa-grip-vertical"></i></span>
          <span class="sb-type-badge ${slide.type}">${isImage ? "IMG" : "HTML"}</span>
          <span class="sb-slide-num">#${idx + 1}</span>
          <button class="sb-duplicate-slide" data-idx="${idx}" title="Duplicate slide">
            <i class="fas fa-clone"></i>
          </button>
          <button class="sb-delete-slide" data-idx="${idx}" title="Delete slide">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        <div class="sb-slide-fields">
          <label>${isImage ? "Image URL" : "HTML Content"}</label>
          ${contentField}
          ${thumbnailHtml}
          ${this._buildCaptionChain(slide, idx)}
          <div class="sb-field-row">
            <div class="sb-field-group">
              <label>Transition</label>
              <select class="sb-field-transition" data-idx="${idx}">
                ${transitionOpts}
              </select>
            </div>
            ${isImage ? `<div class="sb-field-group">
              <label>Ken Burns</label>
              <select class="sb-field-kenburns" data-idx="${idx}">
                ${kenBurnsOpts}
              </select>
            </div>` : ""}
            <div class="sb-field-group">
              <label>Ambient</label>
              <select class="sb-field-particles" data-idx="${idx}">
                ${particleOpts}
              </select>
            </div>
          </div>
          <div class="sb-field-row">
            <div class="sb-field-group" style="flex:3">
              <label>Audio</label>
              <div class="sb-audio-field${slide.audioContinue ? " sb-audio-dimmed" : ""}">
                <input type="text" class="sb-field-audio" data-idx="${idx}"
                  value="${_escapeHtml(slide.audio || "")}"
                  placeholder="Audio file path..." ${slide.audioContinue ? "disabled" : ""} />
                <button class="sb-browse-audio-btn" data-idx="${idx}" title="Browse audio"
                  ${slide.audioContinue ? "disabled" : ""}>
                  <i class="fas fa-music"></i>
                </button>
              </div>
              <label class="sb-checkbox-label">
                <input type="checkbox" class="sb-field-audio-continue" data-idx="${idx}"
                  ${slide.audioContinue ? "checked" : ""} />
                <span>Continue from previous slide</span>
              </label>
            </div>
            <div class="sb-field-group" style="flex:1">
              <label>Typewriter</label>
              <label class="sb-checkbox-label">
                <input type="checkbox" class="sb-field-typewriter" data-idx="${idx}"
                  ${slide.typewriter ? "checked" : ""} />
                <span>Enabled</span>
              </label>
            </div>
          </div>
        </div>
      </li>`;
  }

  _buildCaptionChain(slide, idx) {
    const captions = slide.captions || [];
    const preview = captions.length > 0
      ? _escapeHtml(captions[0].speaker
          ? `${captions[0].speaker}: ${captions[0].text || "..."}`
          : (captions[0].text || "...")).substring(0, 60)
      : "";
    const items = captions.map((cap, cidx) => `
      <div class="sb-caption-item" data-idx="${idx}" data-cidx="${cidx}">
        <div class="sb-caption-item-header">
          <span class="sb-caption-item-num">${cidx + 1}.</span>
          <button class="sb-move-caption-up" data-idx="${idx}" data-cidx="${cidx}" title="Move up"
            ${cidx === 0 ? "disabled" : ""}><i class="fas fa-chevron-up"></i></button>
          <button class="sb-move-caption-down" data-idx="${idx}" data-cidx="${cidx}" title="Move down"
            ${cidx === captions.length - 1 ? "disabled" : ""}><i class="fas fa-chevron-down"></i></button>
          <button class="sb-delete-caption" data-idx="${idx}" data-cidx="${cidx}" title="Remove caption">
            <i class="fas fa-times"></i></button>
        </div>
        <div class="sb-caption-item-fields">
          <label>Speaker</label>
          <input type="text" class="sb-field-caption-speaker" data-idx="${idx}" data-cidx="${cidx}"
            value="${_escapeHtml(cap.speaker)}" placeholder="Character name" />
          <label>Text</label>
          <textarea class="sb-field-caption-text" data-idx="${idx}" data-cidx="${cidx}" rows="2"
            placeholder="Narration text...">${_escapeHtml(cap.text)}</textarea>
        </div>
      </div>
    `).join("");

    return `
      <div class="sb-caption-chain${this._expandedCaptions.has(idx) ? "" : " collapsed"}" data-idx="${idx}">
        <div class="sb-caption-chain-header">
          <span class="sb-caption-chain-toggle" data-idx="${idx}">
            <i class="fas fa-chevron-right"></i>
            Captions (${captions.length})${preview ? `<span class="sb-caption-preview">${preview}</span>` : ""}
          </span>
          <button class="sb-add-caption" data-idx="${idx}" title="Add caption">
            <i class="fas fa-plus"></i></button>
        </div>
        <div class="sb-caption-chain-body">
          ${items}
        </div>
      </div>`;
  }

  /* ── Event listeners ── */

  activateListeners(html) {
    super.activateListeners(html);

    // Deck management
    html.find(".sb-deck-select").on("change", e => this._switchDeck(e.currentTarget.value));
    html.find(".sb-deck-new").on("click", () => this._createDeck());
    html.find(".sb-deck-rename").on("click", () => this._renameDeck());
    html.find(".sb-deck-delete").on("click", () => this._deleteDeck());

    // Add slides
    html.find(".sb-add-image").on("click", () => this._addSlide("image"));
    html.find(".sb-add-html").on("click", () => this._addSlide("html"));

    // Actions
    html.find(".sb-present").on("click", () => this._present(false));
    html.find(".sb-preview").on("click", () => this._present(true));

    // FilePicker (image)
    html.find(".sb-browse-btn").on("click", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      const input = html.find(`.sb-field-content[data-idx="${idx}"]`);
      new FilePicker({
        type: "image",
        current: input.val() || "",
        callback: path => {
          input.val(path);
          this.slides[idx].content = path;
          const preview = html.find(`.sb-thumbnail-preview[data-idx="${idx}"]`);
          if (path) { preview.show().find("img").attr("src", path); }
          else { preview.hide(); }
        }
      }).browse();
    });

    // FilePicker (audio)
    html.find(".sb-browse-audio-btn").on("click", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      const input = html.find(`.sb-field-audio[data-idx="${idx}"]`);
      new FilePicker({
        type: "audio",
        current: input.val() || "",
        callback: path => {
          input.val(path);
          this.slides[idx].audio = path;
        }
      }).browse();
    });

    // Thumbnail live update
    html.find(".sb-field-content").on("input", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      if (this.slides[idx]?.type !== "image") return;
      const preview = html.find(`.sb-thumbnail-preview[data-idx="${idx}"]`);
      const val = e.currentTarget.value.trim();
      if (val) { preview.show().find("img").attr("src", val); }
      else { preview.hide(); }
    });

    // Duplicate slide
    html.find(".sb-duplicate-slide").on("click", e => {
      this._syncFields();
      const idx = Number(e.currentTarget.dataset.idx);
      const clone = foundry.utils.deepClone(this.slides[idx]);
      clone.id = foundry.utils.randomID();
      this.slides.splice(idx + 1, 0, clone);
      this.render(true);
    });

    // Delete slide
    html.find(".sb-delete-slide").on("click", e => {
      this._syncFields();
      this.slides.splice(Number(e.currentTarget.dataset.idx), 1);
      this.render(true);
    });

    // Field auto-save
    html.find(".sb-field-content").on("change", e => {
      this.slides[Number(e.currentTarget.dataset.idx)].content = e.currentTarget.value;
    });
    html.find(".sb-field-transition").on("change", e => {
      this.slides[Number(e.currentTarget.dataset.idx)].transition = e.currentTarget.value;
    });
    html.find(".sb-field-kenburns").on("change", e => {
      this.slides[Number(e.currentTarget.dataset.idx)].kenBurns = e.currentTarget.value;
    });
    html.find(".sb-field-audio").on("change", e => {
      this.slides[Number(e.currentTarget.dataset.idx)].audio = e.currentTarget.value;
    });
    html.find(".sb-field-particles").on("change", e => {
      this.slides[Number(e.currentTarget.dataset.idx)].ambientParticles = e.currentTarget.value;
    });
    html.find(".sb-field-typewriter").on("change", e => {
      this.slides[Number(e.currentTarget.dataset.idx)].typewriter = e.currentTarget.checked;
    });
    html.find(".sb-field-audio-continue").on("change", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      this.slides[idx].audioContinue = e.currentTarget.checked;
      const audioField = html.find(`.sb-audio-field`).eq(idx);
      const audioInput = html.find(`.sb-field-audio[data-idx="${idx}"]`);
      const audioBtn = html.find(`.sb-browse-audio-btn[data-idx="${idx}"]`);
      if (e.currentTarget.checked) {
        audioField.addClass("sb-audio-dimmed");
        audioInput.prop("disabled", true);
        audioBtn.prop("disabled", true);
      } else {
        audioField.removeClass("sb-audio-dimmed");
        audioInput.prop("disabled", false);
        audioBtn.prop("disabled", false);
      }
    });

    // Caption chain: collapse/expand toggle
    html.find(".sb-caption-chain-toggle").on("click", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      const chain = e.currentTarget.closest(".sb-caption-chain");
      chain.classList.toggle("collapsed");
      if (chain.classList.contains("collapsed")) {
        this._expandedCaptions.delete(idx);
      } else {
        this._expandedCaptions.add(idx);
      }
    });

    // Caption chain: add
    html.find(".sb-add-caption").on("click", e => {
      this._syncFields();
      const idx = Number(e.currentTarget.dataset.idx);
      if (!this.slides[idx].captions) this.slides[idx].captions = [];
      this.slides[idx].captions.push({ speaker: "", text: "" });
      this._expandedCaptions.add(idx);
      this.render(true);
    });

    // Caption chain: delete
    html.find(".sb-delete-caption").on("click", e => {
      this._syncFields();
      const idx = Number(e.currentTarget.dataset.idx);
      const cidx = Number(e.currentTarget.dataset.cidx);
      this.slides[idx].captions.splice(cidx, 1);
      this.render(true);
    });

    // Caption chain: move up
    html.find(".sb-move-caption-up").on("click", e => {
      this._syncFields();
      const idx = Number(e.currentTarget.dataset.idx);
      const cidx = Number(e.currentTarget.dataset.cidx);
      if (cidx <= 0) return;
      const arr = this.slides[idx].captions;
      [arr[cidx - 1], arr[cidx]] = [arr[cidx], arr[cidx - 1]];
      this.render(true);
    });

    // Caption chain: move down
    html.find(".sb-move-caption-down").on("click", e => {
      this._syncFields();
      const idx = Number(e.currentTarget.dataset.idx);
      const cidx = Number(e.currentTarget.dataset.cidx);
      const arr = this.slides[idx].captions;
      if (cidx >= arr.length - 1) return;
      [arr[cidx], arr[cidx + 1]] = [arr[cidx + 1], arr[cidx]];
      this.render(true);
    });

    // Caption chain: field auto-save
    html.find(".sb-field-caption-speaker").on("change", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      const cidx = Number(e.currentTarget.dataset.cidx);
      if (this.slides[idx]?.captions?.[cidx]) {
        this.slides[idx].captions[cidx].speaker = e.currentTarget.value;
      }
    });
    html.find(".sb-field-caption-text").on("change", e => {
      const idx = Number(e.currentTarget.dataset.idx);
      const cidx = Number(e.currentTarget.dataset.cidx);
      if (this.slides[idx]?.captions?.[cidx]) {
        this.slides[idx].captions[cidx].text = e.currentTarget.value;
      }
    });

    // Drag-and-drop
    this._initDragDrop(html);
  }

  /* ── Drag & drop ── */

  _initDragDrop(html) {
    let dragIdx = null;
    html.find(".sb-slide-item").each((_, el) => {
      el.addEventListener("dragstart", e => {
        dragIdx = Number(el.dataset.idx);
        el.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragIdx));
      });
      el.addEventListener("dragend", () => {
        el.classList.remove("dragging");
        html.find(".sb-slide-item").removeClass("drag-over");
      });
      el.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        el.classList.add("drag-over");
      });
      el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
      el.addEventListener("drop", e => {
        e.preventDefault();
        el.classList.remove("drag-over");
        const dropIdx = Number(el.dataset.idx);
        if (dragIdx !== null && dragIdx !== dropIdx) {
          this._syncFields();
          const [moved] = this.slides.splice(dragIdx, 1);
          this.slides.splice(dropIdx, 0, moved);
          this.render(true);
        }
        dragIdx = null;
      });
    });
  }

  /* ── Actions ── */

  _addSlide(type) {
    this._syncFields();
    this.slides.push({
      id: foundry.utils.randomID(),
      type,
      content: "",
      captions: [],
      transition: "crossfade",
      kenBurns: "none",
      audio: "",
      audioContinue: false,
      ambientParticles: "none",
      typewriter: false
    });
    this.render(true);
  }

  _syncFields() {
    const el = this.element;
    if (!el?.length) return;
    el.find(".sb-field-content").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].content = inp.value;
    });
    el.find(".sb-field-caption-speaker").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      const cidx = Number(inp.dataset.cidx);
      if (this.slides[idx]?.captions?.[cidx]) {
        this.slides[idx].captions[cidx].speaker = inp.value;
      }
    });
    el.find(".sb-field-caption-text").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      const cidx = Number(inp.dataset.cidx);
      if (this.slides[idx]?.captions?.[cidx]) {
        this.slides[idx].captions[cidx].text = inp.value;
      }
    });
    el.find(".sb-field-transition").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].transition = inp.value;
    });
    el.find(".sb-field-kenburns").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].kenBurns = inp.value;
    });
    el.find(".sb-field-audio").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].audio = inp.value;
    });
    el.find(".sb-field-audio-continue").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].audioContinue = inp.checked;
    });
    el.find(".sb-field-particles").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].ambientParticles = inp.value;
    });
    el.find(".sb-field-typewriter").each((_, inp) => {
      const idx = Number(inp.dataset.idx);
      if (this.slides[idx]) this.slides[idx].typewriter = inp.checked;
    });
  }

  async _present(preview) {
    this._syncFields();
    if (this.slides.length === 0) {
      ui.notifications.warn("GM Storyboard | Add at least one slide before presenting.");
      return;
    }
    await this._saveCurrentDeck();
    startPresentation(this.slides.map(s => ({ ...s })), preview);
  }
}
