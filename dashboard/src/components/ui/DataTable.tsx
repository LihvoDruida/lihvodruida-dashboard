import type { ReactNode } from "react";

export default function DataTable({ caption, headings, children }: {
  caption: string;
  headings: string[];
  children: ReactNode;
}) {
  return <div className="ui-table-scroll" role="region" aria-label={caption} tabIndex={0}>
    <table className="ui-table"><caption>{caption}</caption>
      <thead><tr>{headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}
