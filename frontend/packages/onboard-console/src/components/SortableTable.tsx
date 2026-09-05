import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./sortableTable.css";

// The console's shared sortable table. Sorting is controlled: the caller owns
// the order (and the sort function) and this component only renders headers
// that announce and change it, so several views over one dataset can read the
// same order without each re-sorting. It adds the things every table here
// used to roll on its own: a sticky header, an optionally pinned first column,
// click-to-sort on each column, row selection, and keyboard row navigation
// (arrow keys move, Home/End jump, Enter or Space selects).
//
// First built for the Dispatch Log's Grid view (plans/dispatch-log-spec.md
// §4.3), where the spec noted no such component existed.

export type SortDirection = "asc" | "desc";

export interface SortableColumn<Row> {
  /** Stable id; the key handed back through onSortChange. */
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  /** Default true. */
  sortable?: boolean;
  /** Pin this column to the left edge while the table scrolls sideways. */
  sticky?: boolean;
  /** Class applied to the column's cells. */
  cellClassName?: string;
  /** Accessible header text when `header` is not plain text. */
  label?: string;
}

export interface SortableTableProps<Row> {
  columns: SortableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sortKey: string;
  sortDir: SortDirection;
  onSortChange: (key: string, dir: SortDirection) => void;
  selectedKey?: string | null;
  onSelect?: (key: string, row: Row) => void;
  rowClassName?: (row: Row) => string | undefined;
  /** Required: names the table for assistive tech and for tests. */
  ariaLabel: string;
  className?: string;
  /** Height of the scroll region the sticky header pins to. Default 60vh. */
  maxHeight?: string;
}

export function SortableTable<Row>({
  columns,
  rows,
  rowKey,
  sortKey,
  sortDir,
  onSortChange,
  selectedKey = null,
  onSelect,
  rowClassName,
  ariaLabel,
  className,
  maxHeight = "60vh",
}: SortableTableProps<Row>) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  // Roving tabindex: one row is in the tab order - the selected one when it
  // is in the table, otherwise the first - and arrows move focus from there.
  const focusIndexRef = useRef(0);

  const selectedIndex = selectedKey === null ? -1 : rows.findIndex((row) => rowKey(row) === selectedKey);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  useEffect(() => {
    focusIndexRef.current = tabStop;
  }, [tabStop]);

  const focusRow = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    const el = bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr")[clamped];
    if (el) {
      focusIndexRef.current = clamped;
      el.focus();
    }
  }, [rows.length]);

  function headerClick(column: SortableColumn<Row>) {
    if (column.sortable === false) return;
    const nextDir: SortDirection = sortKey === column.key && sortDir === "asc" ? "desc" : "asc";
    onSortChange(column.key, nextDir);
  }

  function rowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number, row: Row) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect?.(rowKey(row), row);
        break;
    }
  }

  return (
    <div className="sortable-table-scroll" style={{ maxHeight }}>
      <table className={`data sortable-table${className ? ` ${className}` : ""}`} aria-label={ariaLabel}>
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = column.sortable !== false;
              const active = sortable && sortKey === column.key;
              const ariaSort = active ? (sortDir === "asc" ? "ascending" : "descending") : sortable ? "none" : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={`${column.sticky ? "sticky-col" : ""}${active ? " sorted" : ""}`}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="sortable-table-sort"
                      onClick={() => headerClick(column)}
                      aria-label={column.label ?? (typeof column.header === "string" ? column.header : column.key)}
                    >
                      <span>{column.header}</span>
                      <span className="sortable-table-arrow" aria-hidden="true">
                        {active ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={bodyRef}>
          {rows.map((row, index) => {
            const key = rowKey(row);
            const selected = key === selectedKey;
            const extra = rowClassName?.(row);
            return (
              <tr
                key={key}
                className={`${selected ? "selected" : ""}${extra ? ` ${extra}` : ""}`}
                aria-selected={onSelect ? selected : undefined}
                tabIndex={onSelect ? (index === tabStop ? 0 : -1) : undefined}
                onClick={onSelect ? () => onSelect(key, row) : undefined}
                onKeyDown={onSelect ? (event) => rowKeyDown(event, index, row) : undefined}
                onFocus={() => { focusIndexRef.current = index; }}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`${column.sticky ? "sticky-col" : ""}${column.cellClassName ? ` ${column.cellClassName}` : ""}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
