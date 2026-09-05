import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortableTable, type SortDirection, type SortableColumn } from "./SortableTable.js";

interface Row { id: string; name: string; n: number }
const ROWS: Row[] = [
  { id: "a", name: "Apple", n: 3 },
  { id: "b", name: "Banana", n: 1 },
  { id: "c", name: "Cherry", n: 2 },
];
const COLUMNS: SortableColumn<Row>[] = [
  { key: "name", header: "Name", render: (r) => r.name, sticky: true },
  { key: "n", header: "Count", render: (r) => String(r.n) },
  { key: "note", header: "Note", render: () => "—", sortable: false },
];

function Harness({ onSelect }: { onSelect?: (key: string) => void }) {
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [selected, setSelected] = useState<string | null>(null);
  const rows = [...ROWS].sort((a, b) => {
    const v = sortKey === "n" ? a.n - b.n : a.name.localeCompare(b.name);
    return sortDir === "asc" ? v : -v;
  });
  return (
    <SortableTable
      ariaLabel="Fruit"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => r.id}
      sortKey={sortKey}
      sortDir={sortDir}
      onSortChange={(key, dir) => { setSortKey(key); setSortDir(dir); }}
      selectedKey={selected}
      onSelect={(key) => { setSelected(key); onSelect?.(key); }}
    />
  );
}

afterEach(cleanup);

function bodyRows() {
  return within(screen.getByRole("table", { name: "Fruit" })).getAllByRole("row").slice(1);
}

describe("SortableTable", () => {
  it("announces the sort and cycles a column ascending then descending on click", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const name = screen.getByRole("columnheader", { name: /Name/ });
    expect(name).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: /Note/ })).not.toHaveAttribute("aria-sort");

    await user.click(screen.getByRole("button", { name: "Count" }));
    expect(screen.getByRole("columnheader", { name: /Count/ })).toHaveAttribute("aria-sort", "ascending");
    expect(name).toHaveAttribute("aria-sort", "none");
    expect(bodyRows().map((r) => r.textContent)).toEqual(["Banana1—", "Cherry2—", "Apple3—"]);

    await user.click(screen.getByRole("button", { name: "Count" }));
    expect(screen.getByRole("columnheader", { name: /Count/ })).toHaveAttribute("aria-sort", "descending");
    expect(bodyRows()[0]).toHaveTextContent("Apple");
  });

  it("selects on click and marks the row", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await userEvent.setup().click(screen.getByText("Cherry"));
    expect(onSelect).toHaveBeenCalledWith("c");
    expect(bodyRows()[2]).toHaveAttribute("aria-selected", "true");
    expect(bodyRows()[2]).toHaveClass("selected");
  });

  it("moves through rows with the keyboard and selects with Enter", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const user = userEvent.setup();
    // The header's sort buttons precede the rows in the tab order; the rows'
    // single tab stop is the first row until something is selected.
    expect(bodyRows()[0]).toHaveAttribute("tabindex", "0");
    expect(bodyRows()[1]).toHaveAttribute("tabindex", "-1");
    bodyRows()[0]!.focus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(bodyRows()[2]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(bodyRows()[2]).toHaveFocus(); // clamps at the end
    await user.keyboard("{Home}");
    expect(bodyRows()[0]).toHaveFocus();
    await user.keyboard("{End}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("c");
    // The selected row becomes the table's single tab stop.
    expect(bodyRows()[2]).toHaveAttribute("tabindex", "0");
    expect(bodyRows()[0]).toHaveAttribute("tabindex", "-1");
  });

  it("pins the column asked to stay put", () => {
    render(<Harness />);
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveClass("sticky-col");
    expect(within(bodyRows()[0]).getAllByRole("cell")[0]).toHaveClass("sticky-col");
  });
});
