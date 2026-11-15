import type { ReactNode } from "react";

export default function DataTable({ caption, headings, children, className = "", tableClassName = "" }: {
  caption: string;
  headings: string[];
  children: ReactNode;
  className?: string;
  tableClassName?: string;
}) {
  return <div className={`ui-table-scroll ${className}`} role="region" aria-label={caption} tabIndex={0}>
    <table className={`ui-table ${tableClassName}`}><caption>{caption}</caption>
      <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}
