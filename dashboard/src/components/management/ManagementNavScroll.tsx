"use client";

import { useEffect } from "react";

/** On phones the section menu is a horizontal strip: bring the current section into view. */
export default function ManagementNavScroll() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>("nav.management-nav");
    const current = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = current.offsetLeft - nav.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
  }, []);
  return null;
}
