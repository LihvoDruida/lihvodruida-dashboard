"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { resolveLoadingState } from "@/lib/pageState";

type PortalFragment = {
  angle: number;
  radius: number;
  velocity: number;
  size: number;
  alpha: number;
  spin: number;
  phase: number;
  tone: 0 | 1 | 2;
};

const PORTAL_PALETTE = ["108,255,128", "152,92,255", "92,216,255"] as const;

function createFragment(index: number, count: number): PortalFragment {
  const spread = index / Math.max(1, count);
  return {
    angle: spread * Math.PI * 2 + Math.random() * 0.7,
    radius: 82 + Math.random() * 122,
    velocity: 5 + Math.random() * 12,
    size: 1.4 + Math.random() * 3.6,
    alpha: 0.28 + Math.random() * 0.58,
    spin: (Math.random() - 0.5) * 1.2,
    phase: Math.random() * Math.PI * 2,
    tone: (index % 3) as 0 | 1 | 2,
  };
}

function PortalParticleField() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return undefined;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compactQuery = window.matchMedia("(max-width: 640px)");
    const nav = navigator as Navigator & { deviceMemory?: number };
    const lowPower = (nav.hardwareConcurrency || 4) <= 4 || (nav.deviceMemory || 4) <= 4;
    const particleCount = motionQuery.matches ? 12 : lowPower || compactQuery.matches ? 24 : 40;
    const targetFps = motionQuery.matches ? 1 : lowPower ? 24 : 30;
    const frameInterval = 1000 / targetFps;
    const fragments = Array.from({ length: particleCount }, (_, index) => createFragment(index, particleCount));

    let width = 1;
    let height = 1;
    let dpr = 1;
    let animationFrame = 0;
    let previousFrame = 0;
    let visible = !document.hidden;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1 : 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const resetFragment = (fragment: PortalFragment, index: number) => {
      const next = createFragment(index, particleCount);
      fragment.angle = next.angle;
      fragment.radius = 78 + Math.random() * 24;
      fragment.velocity = next.velocity;
      fragment.size = next.size;
      fragment.alpha = next.alpha;
      fragment.spin = next.spin;
      fragment.phase = next.phase;
      fragment.tone = next.tone;
    };

    const draw = (time: number) => {
      context.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.48;
      const baseRadius = Math.min(width, height) * 0.22;
      const rotation = time * 0.00018;

      context.lineWidth = 1;
      for (let arc = 0; arc < 4; arc += 1) {
        const color = PORTAL_PALETTE[arc % PORTAL_PALETTE.length];
        const arcRadius = baseRadius + 20 + arc * 12;
        const start = rotation * (arc % 2 ? -1 : 1) + arc * 1.25;
        context.beginPath();
        context.arc(cx, cy, arcRadius, start, start + 0.58 + arc * 0.06);
        context.strokeStyle = `rgba(${color},${0.2 - arc * 0.025})`;
        context.stroke();
      }

      fragments.forEach((fragment, index) => {
        const wobble = Math.sin(time * 0.0013 + fragment.phase) * 7;
        const angle = fragment.angle + rotation + fragment.spin * 0.08;
        const radius = fragment.radius + wobble;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.72;
        const tangent = angle + Math.PI / 2;
        const size = fragment.size;
        const color = PORTAL_PALETTE[fragment.tone];

        context.save();
        context.translate(x, y);
        context.rotate(tangent + fragment.spin + time * 0.00022);
        context.beginPath();
        context.moveTo(size * 1.8, 0);
        context.lineTo(-size * 0.7, size * 0.62);
        context.lineTo(-size * 0.25, -size * 0.78);
        context.closePath();
        context.fillStyle = `rgba(${color},${fragment.alpha})`;
        context.fill();
        context.restore();

        if (!motionQuery.matches) {
          fragment.radius += fragment.velocity / targetFps;
          fragment.angle += fragment.spin * 0.0015;
          fragment.alpha *= 0.998;
          if (fragment.radius > Math.max(width, height) * 0.52 || fragment.alpha < 0.1) {
            resetFragment(fragment, index);
          }
        }
      });
    };

    const loop = (time: number) => {
      if (!visible) return;
      if (!previousFrame || time - previousFrame >= frameInterval) {
        previousFrame = time;
        draw(time);
      }
      if (!motionQuery.matches) animationFrame = window.requestAnimationFrame(loop);
    };

    const onVisibilityChange = () => {
      visible = !document.hidden;
      if (visible && !motionQuery.matches) {
        previousFrame = 0;
        window.cancelAnimationFrame(animationFrame);
        animationFrame = window.requestAnimationFrame(loop);
      } else {
        window.cancelAnimationFrame(animationFrame);
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    draw(performance.now());
    if (!motionQuery.matches) animationFrame = window.requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return <canvas ref={canvasRef} className="app-loading-particles" aria-hidden="true" />;
}

export default function AppLoadingScreen() {
  const pathname = usePathname();
  const copy = resolveLoadingState(pathname);

  return (
    <main className="app-state-page app-loading-page" aria-busy="true" aria-live="polite">
      <section className="app-state-shell app-loading-shell" role="status" aria-label={copy.title}>
        <div className="app-loading-stage">
          <div className="app-loading-portal" aria-hidden="true">
            <PortalParticleField />
            <div className="app-loading-rift">
              <span className="app-loading-rift-ring app-loading-rift-ring--outer" />
              <span className="app-loading-rift-ring app-loading-rift-ring--inner" />
              <span className="app-loading-rift-core" />
              <span className="app-loading-rift-slice app-loading-rift-slice--a" />
              <span className="app-loading-rift-slice app-loading-rift-slice--b" />
            </div>
            <span className="app-loading-portal-caption">VOID LINK · SECURE TRANSIT</span>
          </div>

          <article className="panel app-loading-card">
            <div className="app-loading-copy">
              <div className="app-loading-kicker-row">
                <span className="app-state-eyebrow app-loading-eyebrow">{copy.eyebrow}</span>
                <span className="app-loading-link-state"><i aria-hidden="true" /> Канал активний</span>
              </div>
              <h1>{copy.title}</h1>
              <p>{copy.message}</p>

              <div className="app-loading-current" aria-label={copy.activeLabel}>
                <span className="app-loading-current-pulse" aria-hidden="true" />
                <span>{copy.activeLabel.replace(/^Зараз:\s*/i, "")}</span>
              </div>

              <p className="app-loading-note">
                Захищений перехід існує лише поки сервер перевіряє дані. Анімація не затримує відкриття сторінки.
              </p>
            </div>
          </article>
        </div>

        <div className="app-loading-progress" aria-hidden="true"><span /></div>

        <ol className="app-loading-steps" aria-label="Етапи завантаження">
          {copy.steps.map((step, index) => (
            <li key={`${step.label}:${step.detail}`} className={`is-${step.state}`}>
              <span className="app-loading-step-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <span className="app-loading-step-copy">
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="app-loading-telemetry" aria-hidden="true">
          <span>SESSION GATE</span><i />
          <span>ROLE MATRIX</span><i />
          <span>DATA STREAM</span><i />
          <span>UI PHASE</span>
        </div>
      </section>
    </main>
  );
}
