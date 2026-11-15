"use client";
import styles from "./management/sections.module.css";

import Button from "@/components/ui/Button";

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Section = { id: string; label: string; description: string };

/** Panels stay mounted: switching tasks must not discard unsaved form values. */
export default function ManagementSections({ sections, children, initialSection, variant = "legacy" }: {
  sections: Section[];
  children: ReactNode;
  initialSection?: string;
  variant?: "legacy" | "universal";
}) {
  const universal = variant === "universal";
  const [active, setActive] = useState(initialSection || sections[0]?.id);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const prefix = useId();
  const panels = Children.toArray(children);
  useEffect(() => {
    let frame: number | undefined;
    const readHash = () => {
      if (frame !== undefined) { cancelAnimationFrame(frame); frame = undefined; }
      const id = window.location.hash.slice(1);
      if (sections.some(section => section.id === id)) { setActive(id); return; }
      // Context actions can target a specific card inside a hidden task panel.
      const target = document.getElementById(id);
      const panel = target?.closest('[role="tabpanel"]');
      const section = sections.find(section => panel?.id === `${prefix}-panel-${section.id}`);
      if (!target || !section) return;
      setActive(section.id);
      frame = requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => { window.removeEventListener("hashchange", readHash); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [sections, prefix]);
  function select(id: string) {
    setActive(id);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${id}`);
  }
  return <div className={universal ? styles.sections : "management-sections"}>
    <div className={universal ? styles.tabs : "management-section-tabs"} role="tablist" aria-label="Задачі на цій сторінці">
      {sections.map((section, index) => <Button key={section.id} type="button" className={`btn ${universal ? styles.tab : "management-section-tab"}`} role="tab"
        id={`${prefix}-tab-${section.id}`} aria-controls={`${prefix}-panel-${section.id}`}
        aria-selected={active === section.id} tabIndex={active === section.id ? 0 : -1}
        ref={element => { tabs.current[index] = element; }}
        onClick={() => select(section.id)} onKeyDown={event => {
          let next = index;
          if (event.key === "ArrowRight") next = (index + 1) % sections.length;
          else if (event.key === "ArrowLeft") next = (index - 1 + sections.length) % sections.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = sections.length - 1;
          else return;
          event.preventDefault(); select(sections[next].id); tabs.current[next]?.focus();
        }}>{!universal ? <span className="management-section-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}{section.label}</Button>)}
    </div>
    {sections.map((section, index) => <div key={section.id} className={universal ? styles.panel : "management-section-panel"} role="tabpanel"
      id={`${prefix}-panel-${section.id}`} aria-labelledby={`${prefix}-tab-${section.id}`}
      hidden={active !== section.id} tabIndex={0}>
      <p className={universal ? styles.description : "management-section-description"}>{section.description}</p>
      {panels[index]}
    </div>)}
  </div>;
}
