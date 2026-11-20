"use client";

import { useEffect } from "react";

/**
 * Поведінка навігації — порт assets/js/mobile-menu.js та
 * assets/js/sidebar-scroll.js із lihvodruida.github.io:
 *
 *  - мобільна панель (бургер + блокування скролу зі збереженням позиції),
 *  - випадне меню акаунта (клік, Escape, клік поза межами),
 *  - клас .is-scrolled на обгортці під час скролу.
 *
 * Розмітку не чіпає: працює через ті самі класи, що й сайт.
 */

const BREAKPOINT = "(max-width: 1000px)";
const SCROLL_THRESHOLD = 8;

export default function SiteNavBehaviour() {
  useEffect(() => {
    const burger = document.querySelector<HTMLButtonElement>(".nav-burger");
    const sheet = document.querySelector<HTMLDialogElement>(".nav-sheet");
    const accountRoot = document.querySelector<HTMLElement>(".nav-account");
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    const body = document.body;

    const cleanups: Array<() => void> = [];

    /* ---------- Мобільна панель ---------- */
    const mq = window.matchMedia(BREAKPOINT);

    if (sheet && burger) {
      let scrollTop = 0;

      const openSheet = () => {
        if (!mq.matches || sheet.open) return;
        scrollTop = window.scrollY;
        sheet.showModal();
        body.style.top = `-${scrollTop}px`;
        body.classList.add("nav-open");
        burger.setAttribute("aria-expanded", "true");
      };
      const restorePage = () => {
        if (sheet.open || !body.classList.contains("nav-open")) return;
        body.classList.remove("nav-open");
        body.style.top = "";
        window.scrollTo({ top: scrollTop, behavior: "instant" });
        burger.setAttribute("aria-expanded", "false");
        if (mq.matches) burger.focus({ preventScroll: true });
      };
      const closeSheet = () => {
        sheet.close();
        restorePage();
      };

      const onSheetClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target === sheet || (target.closest("a[href]") && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey)) closeSheet();
      };
      const onBreakpointChange = () => {
        if (!mq.matches && sheet.open) closeSheet();
      };

      burger.addEventListener("click", openSheet);
      sheet.addEventListener("click", onSheetClick);
      sheet.addEventListener("close", restorePage);
      mq.addEventListener?.("change", onBreakpointChange);

      cleanups.push(() => {
        burger.removeEventListener("click", openSheet);
        sheet.removeEventListener("click", onSheetClick);
        sheet.removeEventListener("close", restorePage);
        mq.removeEventListener?.("change", onBreakpointChange);
        if (sheet.open) sheet.close();
        restorePage();
      });
    }

    /* ---------- Випадне меню акаунта ---------- */
    const dropdownTrigger = accountRoot?.querySelector<HTMLButtonElement>(".nav-account__btn");
    const dropdownMenu = accountRoot?.querySelector<HTMLElement>(".nav-account__menu");

    const dropdownIsOpen = () => Boolean(accountRoot?.classList.contains("is-open"));

    const closeDropdown = () => {
      if (!accountRoot || !dropdownTrigger || !dropdownIsOpen()) return;
      accountRoot.classList.remove("is-open");
      dropdownTrigger.setAttribute("aria-expanded", "false");
    };

    const openDropdown = () => {
      if (!accountRoot || !dropdownTrigger) return;
      accountRoot.classList.add("is-open");
      dropdownTrigger.setAttribute("aria-expanded", "true");
    };

    if (accountRoot && dropdownTrigger && dropdownMenu) {
      const onTriggerClick = (event: MouseEvent) => {
        event.stopPropagation();
        if (dropdownIsOpen()) closeDropdown();
        else openDropdown();
      };
      const onFocusOut = (event: FocusEvent) => {
        if (!accountRoot.contains(event.relatedTarget as Node | null)) closeDropdown();
      };
      const onDocumentClick = (event: MouseEvent) => {
        if (!accountRoot.contains(event.target as Node)) closeDropdown();
      };
      const onAccountEscape = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !dropdownIsOpen()) return;
        event.preventDefault();
        closeDropdown();
        dropdownTrigger.focus({ preventScroll: true });
      };

      dropdownTrigger.addEventListener("click", onTriggerClick);
      accountRoot.addEventListener("focusout", onFocusOut);
      accountRoot.addEventListener("keydown", onAccountEscape);
      document.addEventListener("click", onDocumentClick);

      cleanups.push(() => {
        dropdownTrigger.removeEventListener("click", onTriggerClick);
        accountRoot.removeEventListener("focusout", onFocusOut);
        accountRoot.removeEventListener("keydown", onAccountEscape);
        document.removeEventListener("click", onDocumentClick);
      });
    }

    /* ---------- Щільніша шапка під час скролу ---------- */
    if (sidebar) {
      let frame = 0;

      const update = () => {
        sidebar.classList.toggle("is-scrolled", window.scrollY > SCROLL_THRESHOLD);
        frame = 0;
      };

      const requestUpdate = () => {
        if (!frame) frame = window.requestAnimationFrame(update);
      };

      update();
      window.addEventListener("scroll", requestUpdate, { passive: true });
      window.addEventListener("resize", requestUpdate, { passive: true });

      cleanups.push(() => {
        window.cancelAnimationFrame(frame);
        window.removeEventListener("scroll", requestUpdate);
        window.removeEventListener("resize", requestUpdate);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
