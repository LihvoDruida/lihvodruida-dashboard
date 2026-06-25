(() => {
  "use strict";

  const CONFIG = {
    canvasId: "site-starfield",
    maxStars: 220,
    minStars: 48,
    density: 8200,
    mobileDensity: 15500,
    spotlightRadius: 320,
    drift: 0.18,
  };

  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion) {
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
    if (!body) return;
    if (document.getElementById(CONFIG.canvasId)) return;
    if (body.dataset.starfield === "off") return;

    body.classList.add("has-starfield");

    const canvas = document.createElement("canvas");
    canvas.id = CONFIG.canvasId;
    canvas.setAttribute("aria-hidden", "true");
    body.prepend(canvas);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let stars = [];
    let rafId = 0;
    let paused = document.hidden;
    let resizeTimer = 0;
    const mouse = { x: -9999, y: -9999, active: false };

    class Star {
      constructor(randomPosition = true) {
        this.reset(randomPosition);
      }

      reset(randomPosition = false) {
        this.x = randomPosition ? Math.random() * width : Math.random() > 0.5 ? 0 : width;
        this.y = Math.random() * height;
        this.radius = Math.random() * 1.2 + 0.32;
        this.alpha = Math.random() * 0.42 + 0.14;
        this.twinkle = Math.random() * Math.PI * 2;
        this.vx = (Math.random() - 0.5) * CONFIG.drift;
        this.vy = (Math.random() - 0.5) * CONFIG.drift;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.twinkle += 0.014;

        if (this.x < -4) this.x = width + 4;
        if (this.x > width + 4) this.x = -4;
        if (this.y < -4) this.y = height + 4;
        if (this.y > height + 4) this.y = -4;
      }

      draw() {
        const pulse = (Math.sin(this.twinkle) + 1) * 0.1;
        ctx.globalAlpha = Math.min(0.78, this.alpha + pulse);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function desiredStarCount() {
      const isSmall = Math.min(window.innerWidth, window.innerHeight) < 720;
      const density = isSmall ? CONFIG.mobileDensity : CONFIG.density;
      return Math.max(
        CONFIG.minStars,
        Math.min(CONFIG.maxStars, Math.floor((width * height) / density)),
      );
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#ffffff";

      const count = desiredStarCount();
      if (stars.length === count) return;
      stars = Array.from({ length: count }, () => new Star(true));
    }

    function drawSpotlight() {
      if (!mouse.active) return;
      const gradient = ctx.createRadialGradient(
        mouse.x,
        mouse.y,
        0,
        mouse.x,
        mouse.y,
        CONFIG.spotlightRadius,
      );
      gradient.addColorStop(0, "rgba(200,155,60,0.13)");
      gradient.addColorStop(0.42, "rgba(90,105,210,0.045)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#ffffff";
    }

    function frame() {
      if (paused) return;
      ctx.clearRect(0, 0, width, height);
      drawSpotlight();
      for (const star of stars) {
        star.update();
        star.draw();
      }
      ctx.globalAlpha = 1;
      rafId = window.requestAnimationFrame(frame);
    }

    window.addEventListener(
      "resize",
      () => {
        clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(resize, 140);
      },
      { passive: true },
    );

    document.addEventListener(
      "mousemove",
      (event) => {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
        mouse.active = true;
      },
      { passive: true },
    );

    document.addEventListener("mouseleave", () => {
      mouse.active = false;
    });

    document.addEventListener("visibilitychange", () => {
      paused = document.hidden;
      if (!paused) {
        window.cancelAnimationFrame(rafId);
        rafId = window.requestAnimationFrame(frame);
      }
    });

    resize();
    if (!paused) rafId = window.requestAnimationFrame(frame);
  });
})();
