import { useState } from "react";
import { FixedRouteDepartures } from "./FixedRouteDepartures.js";
import { OnDemandDepartures } from "./OnDemandDepartures.js";
import "./serviceRisk.css";

type ServiceType = "fixed_route" | "on_demand";

const SERVICES: ReadonlyArray<{ key: ServiceType; label: string; description: string }> = [
  {
    key: "fixed_route",
    label: "Fixed Route",
    description:
      "Evaluates whether buses left the garage on schedule using Avail's own dispatch check-in/login/pullout timing. Late and expired pullouts are logged permanently for trend analysis.",
  },
  {
    key: "on_demand",
    label: "On-Demand",
    description:
      "Evaluates whether on-demand duties started on schedule using Spare's start-location slot for each duty, falling back to the vehicle's first sighting in the service area. Logged permanently per duty.",
  },
];

// Garage Departures (Compliance tab). One concept, two sources: Avail
// Pullout measures fixed route and Spare measures on-demand duties, and no
// departure is ever read from both (ADR 0028). The service type picks the
// source; each view owns its own fetch, window, and summary so a source that
// is not connected cannot borrow the other's numbers.
export function GarageDepartures() {
  const [service, setService] = useState<ServiceType>("fixed_route");
  const current = SERVICES.find((s) => s.key === service) ?? SERVICES[0];

  return (
    <div className="risk-module">
      <div className="risk-module-head">
        <div>
          <span className="risk-eyebrow">Compliance investigation</span>
          <h2>Garage Departures</h2>
          <p>{current.description}</p>
        </div>
      </div>

      <div className="occ-switch small" role="tablist" aria-label="Service type">
        {SERVICES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={service === s.key}
            className={service === s.key ? "active" : ""}
            onClick={() => setService(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {service === "fixed_route" ? <FixedRouteDepartures /> : <OnDemandDepartures />}
    </div>
  );
}
