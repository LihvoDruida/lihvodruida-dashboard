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
    const sheet = document.querySelector<HTMLElement>(".nav-sheet");
    const accountRoot = document.querySelector<HTMLElement>(".nav-account");
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    const body = document.body;

    const cleanups: Array<() => void> = [];

    /* ---------- Мобільна панель ---------- */
    let sheetScrollTop = 0;
    const mq = window.matchMedia(BREAKPOINT);

    const sheetIsOpen = () => Boolean(sheet?.classList.contains("is-open"));

    const openSheet = () => {
      if (!sheet || !burger) return;
      sheetScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      body.style.top = `-${sheetScrollTop}px`;
      body.classList.add("nav-open");

      sheet.classList.add("is-open");
      sheet.setAttribute("aria-hidden", "false");
      burger.classList.add("is-active");
      burger.setAttribute("aria-expanded", "true");
      burger.setAttribute("aria-label", "Закрити меню");
    };

    const closeSheet = () => {
      if (!sheet || !burger || !sheetIsOpen()) return;

      const previousTop = body.style.top;
      body.classList.remove("nav-open");
      body.style.top = "";
      const offset = previousTop ? Math.abs(parseInt(previousTop, 10)) : sheetScrollTop;
      window.scrollTo(0, Number.isFinite(offset) ? offset : 0);

      sheet.classList.remove("is-open");
      sheet.setAttribute("aria-hidden", "true");
      burger.classList.remove("is-active");
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", "Відкрити меню");
    };

    if (sheet && burger) {
      sheet.setAttribute("aria-hidden", "true");

      const onBurgerClick = () => (sheetIsOpen() ? closeSheet() : openSheet());
      const onSheetClick = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (target === sheet || target?.closest("a")) closeSheet();
      };
      const onBreakpointChange = () => {
        if (!mq.matches) closeSheet();
      };

      burger.addEventListener("click", onBurgerClick);
      sheet.addEventListener("click", onSheetClick);
      mq.addEventListener?.("change", onBreakpointChange);

      cleanups.push(() => {
        burger.removeEventListener("click", onBurgerClick);
        sheet.removeEventListener("click", onSheetClick);
        mq.removeEventListener?.("change", onBreakpointChange);
        // Сторінка може розмонтуватись при відкритій панелі —
        // інакше body назавжди лишиться position: fixed.
        closeSheet();
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
        dropdownIsOpen() ? closeDropdown() : openDropdown();
      };
      const onFocusOut = (event: FocusEvent) => {
        if (!accountRoot.contains(event.relatedTarget as Node | null)) closeDropdown();
      };
      const onDocumentClick = (event: MouseEvent) => {
        if (!accountRoot.contains(event.target as Node)) closeDropdown();
      };

      dropdownTrigger.addEventListener("click", onTriggerClick);
      accountRoot.addEventListener("focusout", onFocusOut);
      document.addEventListener("click", onDocumentClick);

      cleanups.push(() => {
        dropdownTrigger.removeEventListener("click", onTriggerClick);
        accountRoot.removeEventListener("focusout", onFocusOut);
        document.removeEventListener("click", onDocumentClick);
      });
    }

    /* ---------- Escape закриває обидва ---------- */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeDropdown();
      if (sheetIsOpen()) {
        closeSheet();
        burger?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    cleanups.push(() => document.removeEventListener("keydown", onKeyDown));

    /* ---------- Щільніша шапка під час скролу ---------- */
    if (sidebar) {
      let ticking = false;

      const update = () => {
        sidebar.classList.toggle("is-scrolled", window.scrollY > SCROLL_THRESHOLD);
        ticking = false;
      };

      const requestUpdate = () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
      };

      update();
      window.addEventListener("scroll", requestUpdate, { passive: true });
      window.addEventListener("resize", requestUpdate, { passive: true });

      cleanups.push(() => {
        window.removeEventListener("scroll", requestUpdate);
        window.removeEventListener("resize", requestUpdate);
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
