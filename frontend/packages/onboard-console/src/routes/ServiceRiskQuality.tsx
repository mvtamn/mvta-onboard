import { useState } from "react";
import { FixedRouteServiceRisk } from "./modules/FixedRouteServiceRisk.js";
import { OnDemandServiceQuality } from "./modules/OnDemandServiceQuality.js";

type RiskView = "fixed-route" | "on-demand";

export function ServiceRiskQuality() {
  const [view, setView] = useState<RiskView>("fixed-route");

  return (
    <section className="service-risk-quality" aria-labelledby="service-risk-quality-title">
      <div className="service-risk-quality-head">
        <div>
          <span className="risk-eyebrow">Monitoring workspace</span>
          <h3 id="service-risk-quality-title">Service Risk &amp; Quality</h3>
          <p>Investigate fixed-route departure risk and on-demand customer wait quality in one workspace.</p>
        </div>
      </div>
      <div className="service-risk-quality-tabs" role="tablist" aria-label="Service Risk & Quality views">
        <button
          role="tab"
          aria-selected={view === "fixed-route"}
          className={view === "fixed-route" ? "active" : ""}
          onClick={() => setView("fixed-route")}
        >
          Fixed Route
        </button>
        <button
          role="tab"
          aria-selected={view === "on-demand"}
          className={view === "on-demand" ? "active" : ""}
          onClick={() => setView("on-demand")}
        >
          On-Demand
        </button>
      </div>
      <div role="tabpanel" aria-label={view === "fixed-route" ? "Fixed Route service risk" : "On-Demand service quality"}>
        {view === "fixed-route" ? <FixedRouteServiceRisk /> : <OnDemandServiceQuality />}
      </div>
    </section>
  );
}
