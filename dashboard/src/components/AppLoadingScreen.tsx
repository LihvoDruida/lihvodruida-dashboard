"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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

type ClientTelemetry = {
  device: string;
  network: string;
  viewport: string;
};

type NavigatorWithConnection = Navigator & {
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
};

const PORTAL_PALETTE = ["117,224,137", "92,194,178", "240,168,86"] as const;
const STAGE_DELAYS = [0, 420, 980, 1600] as const;
const STAGE_PROGRESS = [18, 43, 72, 94] as const;

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
    const nav = navigator as NavigatorWithConnection;
    const lowPower = (nav.hardwareConcurrency || 4) <= 4 || (nav.deviceMemory || 4) <= 4;
    const particleCount = motionQuery.matches ? 10 : lowPower || compactQuery.matches ? 22 : 38;
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

function useLoadingStage(pathname: string, stepCount: number) {
  const [activeStage, setActiveStage] = useState(0);

  useEffect(() => {
    setActiveStage(0);
    const timers = STAGE_DELAYS.slice(1, Math.min(stepCount, STAGE_DELAYS.length)).map((delay, index) =>
      window.setTimeout(() => setActiveStage(index + 1), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [pathname, stepCount]);

  return Math.min(activeStage, Math.max(0, stepCount - 1));
}

function useClientTelemetry(): ClientTelemetry {
  const [telemetry, setTelemetry] = useState<ClientTelemetry>({
    device: "CLIENT",
    network: "CONNECT",
    viewport: "—",
  });

  useEffect(() => {
    const update = () => {
      const nav = navigator as NavigatorWithConnection;
      const isMobile = window.matchMedia("(max-width: 640px)").matches;
      const effectiveType = nav.connection?.effectiveType?.trim().toUpperCase();
      const network = !navigator.onLine
        ? "OFFLINE"
        : nav.connection?.saveData
          ? "DATA SAVER"
          : effectiveType || "ONLINE";

      setTelemetry({
        device: isMobile ? "MOBILE" : "DESKTOP",
        network,
        viewport: `${window.innerWidth}×${window.innerHeight}`,
      });
    };

    update();
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return telemetry;
}

export default function AppLoadingScreen() {
  const pathname = usePathname() || "/";
  const copy = useMemo(() => resolveLoadingState(pathname), [pathname]);
  const activeStage = useLoadingStage(pathname, copy.steps.length);
  const telemetry = useClientTelemetry();
  const progress = STAGE_PROGRESS[Math.min(activeStage, STAGE_PROGRESS.length - 1)] || 18;
  const activeStep = copy.steps[activeStage] || copy.steps[0];

  return (
    <main className="app-state-page app-loading-page" aria-busy="true" aria-live="polite">
      <section className="app-state-shell app-loading-shell" role="status" aria-label={copy.title}>
        <div className="app-loading-stage">
          <div className="app-loading-portal" aria-hidden="true">
            <PortalParticleField />
            <div className="app-loading-waygate-frame">
              <span className="app-loading-waygate-node app-loading-waygate-node--a" />
              <span className="app-loading-waygate-node app-loading-waygate-node--b" />
              <span className="app-loading-waygate-node app-loading-waygate-node--c" />
              <div className="app-loading-rift">
                <span className="app-loading-rift-ring app-loading-rift-ring--outer" />
                <span className="app-loading-rift-ring app-loading-rift-ring--inner" />
                <span className="app-loading-rift-core" />
                <span className="app-loading-rift-slice app-loading-rift-slice--a" />
                <span className="app-loading-rift-slice app-loading-rift-slice--b" />
              </div>
              <span className="app-loading-waygate-seal">
                <img src="/mistblossom-icon.png" alt="" />
              </span>
            </div>
            <span className="app-loading-portal-caption">MISTBLOSSOM WAYGATE · LEYLINE STABLE</span>
          </div>

          <article className="panel app-loading-card">
            <div className="app-loading-copy">
              <div className="app-loading-brandline">
                <img src="/mistblossom-icon.png" alt="" />
                <span>
                  <strong>Mistblossom Vanguard</strong>
                  <small>Смарагдовий шлях до панелі</small>
                </span>
              </div>

              <div className="app-loading-kicker-row">
                <span className="app-state-eyebrow app-loading-eyebrow">{copy.eyebrow}</span>
                <span className="app-loading-link-state"><i aria-hidden="true" /> Канал стабільний</span>
              </div>
              <h1>{copy.title}</h1>
              <p>{copy.message}</p>

              <div className="app-loading-current" aria-label={`${activeStep.label}: ${activeStep.detail}`}>
                <span className="app-loading-current-pulse" aria-hidden="true" />
                <span>
                  <strong>{activeStep.label}</strong>
                  <small>{activeStep.detail}</small>
                </span>
              </div>

              <p className="app-loading-note">
                Етапи мають коротку візуальну затримку, щоб стан завантаження читався природно. Готовий маршрут не утримується після фактичного завершення серверної роботи.
              </p>
            </div>
          </article>
        </div>

        <div className="app-loading-progress-head">
          <span>Етап {activeStage + 1} / {copy.steps.length}</span>
          <strong>{progress}%</strong>
        </div>
        <div
          className="app-loading-progress"
          aria-hidden="true"
          style={{ "--app-loading-progress": `${progress}%` } as CSSProperties}
        >
          <span />
        </div>

        <ol className="app-loading-steps" aria-label="Етапи завантаження">
          {copy.steps.map((step, index) => {
            const state = index < activeStage ? "done" : index === activeStage ? "active" : "next";
            return (
              <li key={`${step.label}:${step.detail}`} className={`is-${state}`}>
                <span className="app-loading-step-index" aria-hidden="true">
                  {state === "done" ? "✓" : String(index + 1).padStart(2, "0")}
                </span>
                <span className="app-loading-step-copy">
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="app-loading-telemetry" aria-label="Поточне середовище клієнта">
          <span><b>DEVICE</b>{telemetry.device}</span><i />
          <span><b>NETWORK</b>{telemetry.network}</span><i />
          <span><b>VIEWPORT</b>{telemetry.viewport}</span><i />
          <span><b>ROUTE</b>{pathname === "/" ? "HOME" : pathname.split("/").filter(Boolean)[0]?.toUpperCase() || "HOME"}</span>
        </div>
      </section>
    </main>
  );
}
