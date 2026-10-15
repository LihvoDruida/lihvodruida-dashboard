// The three template scenes, encoded locally as silent, fast-start H.264.
// Desktop 720p and mobile 360p are selected once per mount to avoid resize downloads.
export const LOGIN_BACKGROUND_VIDEOS = [
  "/assets/video/auth/Hyjal02-1280.mp4",
  "/assets/video/auth/Zephras_01-1280.mp4",
  "/assets/video/auth/WowF_TheBarrens_01-1280.mp4",
] as const;
const CROSSFADE_MS = 1_000;
const PLAYBACK_DEADLINE_MS = 15_000;
type Connection = EventTarget & { saveData?: boolean };

/** Attach one rotating background to its static SSR markup; returns full cleanup. */
export function mountLoginVideoBackground(root: HTMLElement) {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>("video"));
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const failed = new Set<number>();
  const listeners: (() => void)[] = [];
  let disposed = false, suppressed = false;
  const mobile = window.matchMedia("(max-width: 760px)").matches;
  let active = -1, pending = -1, generation = 0;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let playbackTimer: ReturnType<typeof setTimeout> | undefined;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  function clearTimers() { clearTimeout(fadeTimer); clearTimeout(playbackTimer); clearTimeout(stallTimer); }
  function paused() { return disposed || suppressed || document.hidden; }
  function listen(target: EventTarget, name: string, fn: () => void) {
    target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn));
  }
  function hide() {
    root.classList.remove("is-on");
    videos.forEach(video => { video.classList.remove("is-shown", "is-retiring"); video.pause(); });
  }
  function nextAfter(index: number) {
    for (let step = 1; step <= videos.length; step++) {
      const next = (index + step) % videos.length;
      if (!failed.has(next)) return next;
    }
    return -1;
  }
  function load(index: number) {
    if (index < 0 || videos[index].hasAttribute("src")) return;
    const video = videos[index];
    video.preload = "auto";
    video.src = (mobile ? video.dataset.mobileSrc : video.dataset.src) || "";
    video.load();
  }
  function release(video: HTMLVideoElement) {
    video.pause(); video.removeAttribute("src"); video.preload = "none"; video.load();
  }
  function fail(index: number) {
    if (paused()) return;
    const relevant = index === active || index === pending;
    failed.add(index); videos[index].pause();
    videos[index].removeAttribute("src"); videos[index].load();
    if (!relevant) return;
    if (index === active) {
      active = -1; root.classList.remove("is-on");
      videos.forEach(video => video.classList.remove("is-shown"));
    }
    if (index === pending) { generation++; pending = -1; clearTimeout(playbackTimer); }
    if (pending < 0) {
      const next = nextAfter(index);
      if (next === active && !videos[next].ended) return;
      if (next >= 0) play(next); else { clearTimers(); hide(); }
    }
  }
  function play(index: number) {
    if (paused() || index < 0 || pending >= 0) return;
    pending = index;
    const ticket = ++generation;
    clearTimeout(playbackTimer); clearTimeout(stallTimer);
    load(index);
    const video = videos[index];
    video.muted = true; video.defaultMuted = true; video.playsInline = true;
    if (index !== active || video.ended) video.currentTime = 0;
    playbackTimer = setTimeout(() => { if (!disposed && generation === ticket) fail(index); }, PLAYBACK_DEADLINE_MS);
    try {
      void video.play().catch(() => { if (!disposed && generation === ticket) fail(index); });
    } catch { if (!disposed && generation === ticket) fail(index); }
  }
  function advance(index: number) {
    if (index !== active || pending >= 0 || paused()) return;
    const next = nextAfter(index);
    if (next === active && !videos[next].ended) return;
    if (next >= 0) play(next); else hide();
  }
  videos.forEach((video, index) => {
    listen(video, "playing", () => {
      if (paused()) { video.pause(); return; }
      if (index !== pending) { if (index !== active) video.pause(); else clearTimeout(stallTimer); return; }
      clearTimeout(playbackTimer); clearTimeout(stallTimer); clearTimeout(fadeTimer);
      const previous = active;
      active = index; pending = -1;
      root.classList.add("is-on");
      videos.forEach((item, number) => {
        item.classList.toggle("is-retiring", number === previous && number !== index);
        item.classList.toggle("is-shown", number === index);
      });
      fadeTimer = setTimeout(() => { if (!disposed) videos.forEach((item, number) => { if (number !== active && number !== pending) { item.classList.remove("is-retiring"); release(item); } }); }, CROSSFADE_MS);
    });
    listen(video, "timeupdate", () => {
      // Prefetch just the next scene near the end; never download all scenes on entry.
      if (index === active && !paused() && Number.isFinite(video.duration) && video.duration - video.currentTime < 5) {
        const next = nextAfter(index);
        if (next !== active) load(next);
      }
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration - video.currentTime <= CROSSFADE_MS / 1_000) advance(index);
    });
    listen(video, "ended", () => advance(index));
    listen(video, "error", () => fail(index));
    listen(video, "waiting", () => {
      if (index !== active || paused()) return;
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => fail(index), PLAYBACK_DEADLINE_MS);
    });
  });
  function policyChanged() {
    if (disposed) return;
    suppressed = motion.matches || Boolean(connection?.saveData);
    generation++; pending = -1; clearTimers();
    if (suppressed) {
      hide(); active = -1; failed.clear();
      videos.forEach(video => { video.removeAttribute("src"); video.load(); });
      return;
    }
    if (document.hidden) { videos.forEach(video => video.pause()); return; }
    const next = active >= 0 && !failed.has(active) ? active : nextAfter(-1);
    if (next >= 0) play(next);
  }
  listen(document, "visibilitychange", policyChanged);
  listen(motion, "change", policyChanged);
  if (connection) listen(connection, "change", policyChanged);
  policyChanged();
  return () => {
    disposed = true; generation++; clearTimers(); listeners.forEach(remove => remove()); hide();
    videos.forEach(video => { video.removeAttribute("src"); video.load(); });
  };
}
