"use client";

import { Children, useEffect, useId, useRef, useState, type ReactNode } from "react";

type Section = { id: string; label: string; description: string };

/** Panels stay mounted: switching tasks must not discard unsaved form values. */
export default function ManagementSections({ sections, children, initialSection }: {
  sections: Section[];
  children: ReactNode;
  initialSection?: string;
}) {
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
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
  }
  return <div className="management-sections">
    <div className="management-section-tabs" role="tablist" aria-label="Задачі на цій сторінці">
      {sections.map((section, index) => <button key={section.id} type="button" className="btn management-section-tab" role="tab"
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
        }}><span className="management-section-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.label}</button>)}
    </div>
    {sections.map((section, index) => <div key={section.id} className="management-section-panel" role="tabpanel"
      id={`${prefix}-panel-${section.id}`} aria-labelledby={`${prefix}-tab-${section.id}`}
      hidden={active !== section.id} tabIndex={0}>
      <p className="management-section-description">{section.description}</p>
      {panels[index]}
    </div>)}
  </div>;
}
