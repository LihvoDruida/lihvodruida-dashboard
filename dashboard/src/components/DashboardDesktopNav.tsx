"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import DashboardNavIcon from "@/components/DashboardNavIcon";

type DashboardNavItem = {
  href: string;
  section: string;
  label: string;
  desktopLabel: string;
};

const ITEM_GAP = 4;
const NAV_PADDING = 96;
const ACTIVE_VISIBILITY_FALLBACK = 1;
/** Скільки пунктів лишається в капсулі навіть на найвужчому десктопі. */
const MIN_VISIBLE_ITEMS = 3;

function getMeasuredWidth(element: HTMLElement | null) {
  if (!element) return 0;
  return Math.ceil(element.getBoundingClientRect().width);
}

function buildVisibleIndexes(total: number, visibleCount: number, activeIndex: number) {
  if (visibleCount >= total) {
    return Array.from({ length: total }, (_, index) => index);
  }

  const safeVisibleCount = Math.max(ACTIVE_VISIBILITY_FALLBACK, Math.min(total, visibleCount));
  const base = Array.from({ length: safeVisibleCount }, (_, index) => index);

  if (activeIndex >= 0 && activeIndex >= safeVisibleCount && !base.includes(activeIndex)) {
    base[safeVisibleCount - 1] = activeIndex;
  }

  return Array.from(new Set(base)).sort((left, right) => left - right);
}

export default function DashboardDesktopNav({
  items,
  activeSection,
}: {
  items: DashboardNavItem[];
  activeSection: string;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(items.length);
  // compact = лишаються тільки іконки. Це перший ступінь стиснення,
  // і лише коли навіть іконки не влазять — вмикається «Ще».
  const [compact, setCompact] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const measureItemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const measureCompactRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const measureMoreRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const activeIndex = items.findIndex((item) => item.section === activeSection);

  const visibleIndexes = useMemo(
    () => buildVisibleIndexes(items.length, visibleCount, activeIndex),
    [items.length, visibleCount, activeIndex],
  );

  const visibleSet = useMemo(() => new Set(visibleIndexes), [visibleIndexes]);
  const primaryNavItems = items.filter((_, index) => visibleSet.has(index));
  const secondaryNavItems = items.filter((_, index) => !visibleSet.has(index));
  const activeSecondaryItem = secondaryNavItems.find((item) => item.section === activeSection) || null;

  useLayoutEffect(() => {
    const nav = railRef.current;
    if (!nav) return;

    let frame = 0;

    const recompute = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        // Капсула тепер обіймає вміст, тож міряти саму рейку не можна —
        // вона залежала б від того, що всередині, і перехід «підписи → іконки»
        // став би дверима в один бік. Тому рахуємо вільне місце від шапки:
        // її ширина визначається вікном, а лого й профіль не змінюються
        // від режиму навігації.
        const header = nav.closest(".dashboard-topbar") as HTMLElement | null;
        const brand = header?.querySelector(".dashboard-brand") as HTMLElement | null;
        const profile = header?.querySelector(".dashboard-user") as HTMLElement | null;
        const headerWidth = header ? Math.floor(header.clientWidth) : 0;
        const availableWidth = headerWidth
          ? headerWidth - getMeasuredWidth(brand) - getMeasuredWidth(profile) - NAV_PADDING
          : Math.floor(nav.getBoundingClientRect().width) - NAV_PADDING;
        const labelWidths = items.map((_, index) => getMeasuredWidth(measureItemRefs.current[index] || null));
        const iconWidths = items.map((_, index) => getMeasuredWidth(measureCompactRefs.current[index] || null));
        const moreWidth = Math.max(getMeasuredWidth(measureMoreRef.current), 64);

        if (!availableWidth || labelWidths.some((width) => width <= 0) || iconWidths.some((width) => width <= 0)) {
          setCompact(false);
          setVisibleCount(items.length);
          return;
        }

        const totalWidth = (widths: number[]) =>
          widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * ITEM_GAP;

        // Ступінь 1: усе з підписами.
        if (totalWidth(labelWidths) <= availableWidth) {
          setCompact(false);
          setVisibleCount(items.length);
          return;
        }

        // Ступінь 2: ті самі пункти, але самими іконками.
        if (totalWidth(iconWidths) <= availableWidth) {
          setCompact(true);
          setVisibleCount(items.length);
          return;
        }

        // Ступінь 3: іконки + частина розділів їде у «Ще».
        let consumed = 0;
        let count = 0;
        for (let index = 0; index < iconWidths.length; index += 1) {
          const width = iconWidths[index];
          const nextGap = count > 0 ? ITEM_GAP : 0;
          const reservedMore = index < iconWidths.length - 1 ? ITEM_GAP + moreWidth : 0;
          if (consumed + nextGap + width + reservedMore > availableWidth) break;
          consumed += nextGap + width;
          count += 1;
        }

        setCompact(true);
        setVisibleCount(
          Math.max(ACTIVE_VISIBILITY_FALLBACK, Math.min(items.length, Math.max(count, Math.min(MIN_VISIBLE_ITEMS, items.length)))),
        );
      });
    };

    recompute();

    const observer = new ResizeObserver(recompute);
    observer.observe(nav);
    if (nav.parentElement) observer.observe(nav.parentElement);
    const header = nav.closest(".dashboard-topbar");
    if (header) observer.observe(header);
    measureItemRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });
    measureCompactRefs.current.forEach((node) => {
      if (node) observer.observe(node);
    });
    if (measureMoreRef.current) observer.observe(measureMoreRef.current);

    window.addEventListener("resize", recompute);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [items]);

  useEffect(() => {
    if (!open) return;

    // pointerdown замість mousedown: на тач-екранах mousedown не спрацьовує
    // до завершення тапу, тож меню не закривалося дотиком поза ним.
    const handlePointerDown = (event: PointerEvent) => {
      if (!moreRef.current) return;
      if (!moreRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Без повернення фокуса він лишався на закритому меню, і подальша
      // навігація з клавіатури провалювалася на початок сторінки.
      triggerRef.current?.focus();
    };

    // Меню лишалося відкритим «за спиною», якщо піти з нього табом.
    const handleFocusIn = (event: FocusEvent) => {
      if (!moreRef.current) return;
      if (!moreRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
    };
  }, [open]);

  useEffect(() => {
    if (!secondaryNavItems.length && open) {
      setOpen(false);
    }
  }, [secondaryNavItems.length, open]);

  return (
    <>
      {/* Рейка на всю ширину колонки: саме вона вимірюється для згортання
          пунктів у «Ще». Капсула всередині лишається завширшки з вміст. */}
      <div ref={railRef} className="dashboard-nav-rail">
        <nav
          className="dashboard-nav dashboard-nav--desktop"
          aria-label="Панель керування"
          data-compact={compact ? "true" : "false"}
          data-items={items.length}
          data-overflow={secondaryNavItems.length > 0 ? "true" : "false"}
        >
        {primaryNavItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={activeSection === item.section ? "is-active" : undefined}
            aria-current={activeSection === item.section ? "page" : undefined}
            aria-label={item.desktopLabel}
            title={item.desktopLabel}
          >
            <DashboardNavIcon section={item.section} />
            <span className="dashboard-nav__label">{item.desktopLabel}</span>
          </a>
        ))}

        {secondaryNavItems.length > 0 ? (
          <div ref={moreRef} className={`dashboard-nav-more${open ? " is-open" : ""}`}>
            <button
              type="button"
              ref={triggerRef}
              className={`dashboard-nav-more__trigger${activeSecondaryItem ? " is-active" : ""}`}
              aria-haspopup="true"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => setOpen((value) => !value)}
              title={activeSecondaryItem ? `Поточний додатковий розділ: ${activeSecondaryItem.desktopLabel}` : "Додаткові розділи"}
            >
              <span className="dashboard-nav-more__trigger-label dashboard-nav__label">Ще</span>
              <span className="dashboard-nav-more__trigger-count" aria-hidden="true">{secondaryNavItems.length}</span>
            </button>

            <div id={menuId} className="dashboard-nav-more__menu" aria-hidden={!open}>
              <div className="dashboard-nav-more__menu-head">
                <strong>Додаткові розділи</strong>
                <span>{activeSecondaryItem ? `Активний: ${activeSecondaryItem.desktopLabel}` : "Швидкий доступ до інших сторінок"}</span>
              </div>

              <div className="dashboard-nav-more__menu-list">
                {secondaryNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={activeSection === item.section ? "is-active" : undefined}
                    aria-current={activeSection === item.section ? "page" : undefined}
                    title={item.desktopLabel}
                    onClick={() => setOpen(false)}
                  >
                    <DashboardNavIcon section={item.section} />
                    <strong>{item.desktopLabel}</strong>
                    <small>{activeSection === item.section ? "Відкрито" : "Перейти"}</small>
                  </a>
                ))}
              </div>
            </div>
          </div>
          ) : null}
        </nav>
      </div>

      <div className="dashboard-nav-measure" aria-hidden="true" inert>
        {items.map((item, index) => (
          <a
            key={`${item.href}-measure`}
            ref={(node) => {
              measureItemRefs.current[index] = node;
            }}
            className="dashboard-nav-measure__item"
          >
            <DashboardNavIcon section={item.section} />
            <span>{item.desktopLabel}</span>
          </a>
        ))}
        {items.map((item, index) => (
          <a
            key={`${item.href}-measure-compact`}
            ref={(node) => {
              measureCompactRefs.current[index] = node;
            }}
            className="dashboard-nav-measure__item dashboard-nav-measure__item--compact"
          >
            <DashboardNavIcon section={item.section} />
          </a>
        ))}
        <button
          ref={measureMoreRef}
          type="button"
          className="dashboard-nav-measure__more"
        >
          <span>Ще</span>
          <span className="dashboard-nav-measure__count">9</span>
        </button>
      </div>
    </>
  );
}
