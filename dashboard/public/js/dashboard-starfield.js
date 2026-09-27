(() => {
  "use strict";

  const CONFIG = {
    canvasId: "site-starfield",
    desktopMaxStars: 160,
    mobileMaxStars: 72,
    desktopMinStars: 36,
    mobileMinStars: 22,
    desktopDensity: 11000,
    mobileDensity: 26000,
    spotlightRadius: 300,
    drift: 0.16,
    desktopFps: 30,
    mobileFps: 24,
  };

  const mediaReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const saveData = Boolean(connection?.saveData);
  const lowMemory = Number(navigator.deviceMemory || 0) > 0 && Number(navigator.deviceMemory) <= 2;

  // Decorative work must never compete with the actual dashboard on devices
  // that explicitly request less motion/data or have very little memory.
  if (mediaReducedMotion?.matches || saveData || lowMemory) {
    document.documentElement.classList.add("starfield-reduced-motion");
    return;
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(() => {
    const body = document.body;
    if (!body || document.getElementById(CONFIG.canvasId) || body.dataset.starfield === "off") return;

    body.classList.add("has-starfield");

    const canvas = document.createElement("canvas");
    canvas.id = CONFIG.canvasId;
    canvas.setAttribute("aria-hidden", "true");
    body.prepend(canvas);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      canvas.remove();
      return;
    }

    let width = 0;
    let height = 0;
    let dpr = 1;
    let stars = [];
    let rafId = 0;
    let paused = document.hidden;
    let resizeTimer = 0;
    let lastFrameAt = 0;
    let isSmall = false;
    let frameInterval = 1000 / CONFIG.desktopFps;
    const mouse = { x: -9999, y: -9999, active: false };

    class Star {
      constructor(randomPosition = true) {
        this.reset(randomPosition);
      }

      reset(randomPosition = false) {
        this.x = randomPosition ? Math.random() * width : Math.random() > 0.5 ? 0 : width;
        this.y = Math.random() * height;
        this.radius = Math.random() * 1.15 + 0.28;
        this.alpha = Math.random() * 0.38 + 0.12;
        this.twinkle = Math.random() * Math.PI * 2;
        this.vx = (Math.random() - 0.5) * CONFIG.drift;
        this.vy = (Math.random() - 0.5) * CONFIG.drift;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.twinkle += 0.018;
        if (this.x < -4) this.x = width + 4;
        if (this.x > width + 4) this.x = -4;
        if (this.y < -4) this.y = height + 4;
        if (this.y > height + 4) this.y = -4;
      }

      draw() {
        const pulse = (Math.sin(this.twinkle) + 1) * 0.09;
        ctx.globalAlpha = Math.min(0.72, this.alpha + pulse);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function desiredStarCount() {
      const density = isSmall ? CONFIG.mobileDensity : CONFIG.desktopDensity;
      const min = isSmall ? CONFIG.mobileMinStars : CONFIG.desktopMinStars;
      const max = isSmall ? CONFIG.mobileMaxStars : CONFIG.desktopMaxStars;
      return Math.max(min, Math.min(max, Math.floor((width * height) / density)));
    }

    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      isSmall = Math.min(width, height) < 720 || coarsePointer;
      frameInterval = 1000 / (isSmall ? CONFIG.mobileFps : CONFIG.desktopFps);
      dpr = Math.min(window.devicePixelRatio || 1, isSmall ? 1.25 : 1.5);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";

      const count = desiredStarCount();
      if (stars.length > count) stars.length = count;
      while (stars.length < count) stars.push(new Star(true));
    }

    function drawSpotlight() {
      if (isSmall || !mouse.active) return;
      const gradient = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, CONFIG.spotlightRadius);
      gradient.addColorStop(0, "rgba(200,155,60,0.12)");
      gradient.addColorStop(0.42, "rgba(90,105,210,0.04)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
    }

    function frame(timestamp) {
      if (paused) return;
      rafId = window.requestAnimationFrame(frame);
      if (timestamp - lastFrameAt < frameInterval) return;
      lastFrameAt = timestamp;

      ctx.clearRect(0, 0, width, height);
      drawSpotlight();
      for (const star of stars) {
        star.update();
        star.draw();
      }
      ctx.globalAlpha = 1;
    }

    function pause() {
      paused = true;
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    function resume() {
      if (!paused && rafId) return;
      paused = false;
      lastFrameAt = 0;
      rafId = window.requestAnimationFrame(frame);
    }

    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 160);
    }, { passive: true });

    if (!coarsePointer) {
      document.addEventListener("mousemove", (event) => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
        mouse.active = true;
      }, { passive: true });
      document.addEventListener("mouseleave", () => { mouse.active = false; });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
      else resume();
    });
    window.addEventListener("pagehide", pause, { passive: true });
    window.addEventListener("pageshow", () => { if (!document.hidden) resume(); }, { passive: true });

    resize();
    if (!paused) resume();
  });
})();
