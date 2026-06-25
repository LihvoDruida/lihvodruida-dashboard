"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

type DashboardNavItem = {
  href: string;
  section: string;
  label: string;
  desktopLabel: string;
};

const ITEM_GAP = 8;
const NAV_PADDING = 12;
const ACTIVE_VISIBILITY_FALLBACK = 1;

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
  const navRef = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const measureItemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
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
    const nav = navRef.current;
    if (!nav) return;

    let frame = 0;

    const recompute = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const availableWidth = Math.floor(nav.getBoundingClientRect().width) - NAV_PADDING;
        const itemWidths = items.map((_, index) => getMeasuredWidth(measureItemRefs.current[index] || null));
        const moreWidth = Math.max(getMeasuredWidth(measureMoreRef.current), 96);

        if (!availableWidth || itemWidths.some((width) => width <= 0)) {
          setVisibleCount(items.length);
          return;
        }

        const fullWidth = itemWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, items.length - 1) * ITEM_GAP;
        if (fullWidth <= availableWidth) {
          setVisibleCount(items.length);
          return;
        }

        let consumed = 0;
        let count = 0;
        for (let index = 0; index < itemWidths.length; index += 1) {
          const width = itemWidths[index];
          const nextGap = count > 0 ? ITEM_GAP : 0;
          const reservedMore = index < itemWidths.length - 1 ? ITEM_GAP + moreWidth : 0;
          if (consumed + nextGap + width + reservedMore > availableWidth) {
            break;
          }
          consumed += nextGap + width;
          count += 1;
        }

        const nextVisibleCount = Math.max(ACTIVE_VISIBILITY_FALLBACK, Math.min(items.length, count));
        setVisibleCount(nextVisibleCount);
      });
    };

    recompute();

    const observer = new ResizeObserver(recompute);
    observer.observe(nav);
    if (nav.parentElement) observer.observe(nav.parentElement);
    measureItemRefs.current.forEach((node) => {
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

    const handlePointerDown = (event: MouseEvent) => {
      if (!moreRef.current) return;
      if (!moreRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!secondaryNavItems.length && open) {
      setOpen(false);
    }
  }, [secondaryNavItems.length, open]);

  return (
    <>
      <nav
        ref={navRef}
        className="dashboard-nav dashboard-nav--desktop"
        aria-label="Панель керування"
        data-items={items.length}
        data-overflow={secondaryNavItems.length > 0 ? "true" : "false"}
      >
        {primaryNavItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={activeSection === item.section ? "is-active" : undefined}
            aria-current={activeSection === item.section ? "page" : undefined}
            title={item.desktopLabel}
          >
            <span>{item.desktopLabel}</span>
          </a>
        ))}

        {secondaryNavItems.length > 0 ? (
          <div ref={moreRef} className={`dashboard-nav-more${open ? " is-open" : ""}`}>
            <button
              type="button"
              className={`dashboard-nav-more__trigger${activeSecondaryItem ? " is-active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={menuId}
              onClick={() => setOpen((value) => !value)}
              title={activeSecondaryItem ? `Поточний додатковий розділ: ${activeSecondaryItem.desktopLabel}` : "Додаткові розділи"}
            >
              <span className="dashboard-nav-more__trigger-label">Ще</span>
              <span className="dashboard-nav-more__trigger-count" aria-hidden="true">{secondaryNavItems.length}</span>
            </button>

            <div id={menuId} className="dashboard-nav-more__menu" role="menu" aria-hidden={!open}>
              <div className="dashboard-nav-more__menu-head">
                <strong>Додаткові розділи</strong>
                <span>{activeSecondaryItem ? `Активний: ${activeSecondaryItem.desktopLabel}` : "Швидкий доступ до інших сторінок"}</span>
              </div>

              <div className="dashboard-nav-more__menu-list">
                {secondaryNavItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={activeSection === item.section ? "is-active" : undefined}
                    aria-current={activeSection === item.section ? "page" : undefined}
                    title={item.desktopLabel}
                    onClick={() => setOpen(false)}
                  >
                    <strong>{item.desktopLabel}</strong>
                    <small>{activeSection === item.section ? "Відкрито" : "Перейти"}</small>
                  </a>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </nav>

      <div className="dashboard-nav-measure" aria-hidden="true">
        {items.map((item, index) => (
          <a
            key={`${item.href}-measure`}
            ref={(node) => {
              measureItemRefs.current[index] = node;
            }}
            className="dashboard-nav-measure__item"
          >
            <span>{item.desktopLabel}</span>
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
