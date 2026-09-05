import { START_BUCKETS, filtersActive, type TripStartFilters } from "./tripStartLogState.js";

interface Props {
  filters: TripStartFilters;
  routes: string[];
  onChange: (next: TripStartFilters) => void;
}

// Shared by every view (spec §4.3): search, route, status, and the
// All trips ⇄ Today's rotation scope. Clear only appears once something is set.
export function TripStartLogQueryBar({ filters, routes, onChange }: Props) {
  const set = <K extends keyof TripStartFilters>(key: K, value: TripStartFilters[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="tsl-query" role="search" aria-label="Filter trips">
      <input
        type="search"
        aria-label="Search trips"
        placeholder="Search route, block, stop, direction"
        value={filters.search}
        onChange={(e) => set("search", e.target.value)}
      />
      <select aria-label="Route" value={filters.route} onChange={(e) => set("route", e.target.value)}>
        <option value="all">All routes</option>
        {routes.map((route) => (
          <option key={route} value={route}>{route}</option>
        ))}
      </select>
      <select
        aria-label="Start status"
        value={filters.status}
        onChange={(e) => set("status", e.target.value as TripStartFilters["status"])}
      >
        <option value="all">All statuses</option>
        {START_BUCKETS.map((bucket) => (
          <option key={bucket.key} value={bucket.key}>{bucket.label}</option>
        ))}
      </select>
      <div className="tsl-scope" role="group" aria-label="Trip scope">
        <button
          type="button"
          className={filters.rotationOnly ? "" : "active"}
          aria-pressed={!filters.rotationOnly}
          onClick={() => set("rotationOnly", false)}
        >
          All trips
        </button>
        <button
          type="button"
          className={filters.rotationOnly ? "active" : ""}
          aria-pressed={filters.rotationOnly}
          onClick={() => set("rotationOnly", true)}
        >
          Today's rotation
        </button>
      </div>
      {filtersActive(filters) ? (
        <button type="button" className="btn-sm" onClick={() => onChange({ search: "", route: "all", status: "all", rotationOnly: false })}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
