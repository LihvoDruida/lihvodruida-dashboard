"use client";

import { useEffect } from "react";

const MOBILE_NAV_SELECTOR = ".dashboard-mobile-nav";
const MOBILE_NAV_SHELL_SELECTOR = ".dashboard-mobile-nav-shell";

function getViewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function setRootVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function clearRootVars() {
  document.documentElement.style.removeProperty("--dash-mobile-nav-actual-height");
  document.documentElement.style.removeProperty("--dash-mobile-nav-actual-bottom");
}

function syncOverflowState(nav: HTMLElement | null, shell: HTMLElement | null) {
  if (!nav || !shell || shell.offsetParent === null) return;

  const maxScrollLeft = Math.max(0, nav.scrollWidth - nav.clientWidth);
  const hasOverflow = maxScrollLeft > 2;
  const canScrollLeft = nav.scrollLeft > 2;
  const canScrollRight = nav.scrollLeft < maxScrollLeft - 2;

  shell.classList.toggle("has-overflow", hasOverflow);
  shell.classList.toggle("is-scrollable", hasOverflow);
  shell.classList.toggle("can-scroll-left", hasOverflow && canScrollLeft);
  shell.classList.toggle("can-scroll-right", hasOverflow && canScrollRight);
}

function scrollActiveItemIntoView(nav: HTMLElement | null) {
  if (!nav) return;

  const activeItem = nav.querySelector<HTMLElement>('a[aria-current="page"], a.is-active');
  if (!activeItem) return;

  const navRect = nav.getBoundingClientRect();
  const itemRect = activeItem.getBoundingClientRect();
  const isFullyVisible = itemRect.left >= navRect.left + 8 && itemRect.right <= navRect.right - 8;
  if (isFullyVisible) return;

  const targetLeft = activeItem.offsetLeft - Math.max(0, (nav.clientWidth - activeItem.offsetWidth) / 2);
  nav.scrollTo({ left: targetLeft, behavior: "auto" });
}

export default function MobileNavSafeAreaSync() {
  useEffect(() => {
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let observedNav: HTMLElement | null = null;
    let observedShell: HTMLElement | null = null;
    let didInitialActiveScroll = false;

    const onNavScroll = () => scheduleUpdate();

    const observe = (nav: HTMLElement | null, shell: HTMLElement | null) => {
      if (nav === observedNav && shell === observedShell) return;

      resizeObserver?.disconnect();
      resizeObserver = null;
      observedNav?.removeEventListener("scroll", onNavScroll);
      observedNav = nav;
      observedShell = shell;

      nav?.addEventListener("scroll", onNavScroll, { passive: true });

      if (!("ResizeObserver" in window)) return;

      resizeObserver = new ResizeObserver(scheduleUpdate);
      if (nav) {
        resizeObserver.observe(nav);
        Array.from(nav.children).forEach((child) => resizeObserver?.observe(child));
      }
      if (shell) resizeObserver.observe(shell);
    };

    const update = () => {
      frame = 0;

      const nav = document.querySelector<HTMLElement>(MOBILE_NAV_SELECTOR);
      const shell = document.querySelector<HTMLElement>(MOBILE_NAV_SHELL_SELECTOR);
      observe(nav, shell);

      const measured = shell || nav;
      if (!measured || measured.offsetParent === null) {
        clearRootVars();
        if (shell) {
          shell.classList.remove("has-overflow", "is-scrollable", "can-scroll-left", "can-scroll-right");
        }
        return;
      }

      if (!didInitialActiveScroll && nav) {
        didInitialActiveScroll = true;
        scrollActiveItemIntoView(nav);
      }

      const rect = measured.getBoundingClientRect();
      const height = Math.max(0, Math.ceil(rect.height));
      const bottomGap = Math.max(0, Math.ceil(getViewportHeight() - rect.bottom));
      setRootVar("--dash-mobile-nav-actual-height", `${height}px`);
      setRootVar("--dash-mobile-nav-actual-bottom", `${bottomGap}px`);
      syncOverflowState(nav, shell);
    };

    function scheduleUpdate() {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    }

    const mutationObserver = new MutationObserver(() => {
      didInitialActiveScroll = false;
      scheduleUpdate();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-items", "aria-current"],
    });

    scheduleUpdate();
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("orientationchange", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);
    document.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("orientationchange", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
      document.removeEventListener("scroll", scheduleUpdate, true);
      observedNav?.removeEventListener("scroll", onNavScroll);
      observedShell?.classList.remove("has-overflow", "is-scrollable", "can-scroll-left", "can-scroll-right");
      clearRootVars();
    };
  }, []);

  return null;
}
