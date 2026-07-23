import { useMemo, useState } from "react";
import {
  POOL,
  INITIAL_MONITORED,
  statusColor,
  statusLabel,
  type Vehicle,
} from "./eventMonitoring.data.js";
import "./eventMonitoring.css";

// Event Vehicle Monitoring — ported from event_monitoring_mockup.html.
// Delay alerts are staff-reviewed: Approve routes through the core Messages
// pipeline (a suggested alert becomes a published message only on approval),
// consistent with the human-in-the-loop principle. Nothing auto-publishes.
export function EventMonitoring() {
  const [monitoredIds, setMonitoredIds] = useState<string[]>(INITIAL_MONITORED);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [swapFor, setSwapFor] = useState<string | null>(null);

  const byId = (id: string) => POOL.find((p) => p.id === id) as Vehicle;
  const monitored = monitoredIds.map(byId);

  const delayedCount = monitored.filter((v) => v.delay && v.delay >= 10).length;
  const activeAlerts = monitored.filter((v) => v.delay && v.delay >= 10 && !dismissed[v.id]);
  const spares = useMemo(() => POOL.filter((p) => !monitoredIds.includes(p.id)), [monitoredIds]);

  function doSwap(incomingId: string) {
    if (!swapFor) return;
    setMonitoredIds((ids) => ids.map((id) => (id === swapFor ? incomingId : id)));
    setSwapFor(null);
  }

  function approve(v: Vehicle) {
    // TODO: POST /suggested-alerts/{id}/approve → publishes through the core
    // Messages pipeline (POST /messages). Stubbed for the mockup.
    window.alert(
      `Would publish a delay alert for ${v.id} through the Messages pipeline (POST /messages).`,
    );
  }

  return (
    <div className="evmon">
      <div className="evmon-layout">
        <aside className="evmon-side">
          <div className="side-label">Data source</div>
          <div className="live-badge">
            <span className="live-dot" />
            Live · GTFS-RT + MN 511
          </div>
          <div className="datasource-card">
            <div><span className="ok">✓</span> Live from GTFS-RT + MN 511</div>
            Vehicles: {POOL.length} · Corridors: 3
            <br />
            Synced 12s ago
          </div>

          <div className="side-label">Monitored</div>
          {monitored.map((v) => (
            <div className="monitor-card" key={v.id} style={{ borderLeftColor: statusColor(v) }}>
              <div className="veh">{v.id}</div>
              <div style={{ color: statusColor(v) }}>{statusLabel(v)}</div>
            </div>
          ))}

          <div className="side-label">Registry totals</div>
          <div className="totals-row"><span>Vehicles (event)</span><span className="n">{POOL.length}</span></div>
          <div className="totals-row"><span>Monitored</span><span className="n">{monitoredIds.length}</span></div>
          <div className="totals-row"><span>Delayed</span><span className="n">{delayedCount}</span></div>
          <div className="totals-row"><span>Offline</span><span className="n">{POOL.filter((p) => p.status === "offline").length}</span></div>
        </aside>

        <div className="evmon-main">
          <div className="map-card">
            <svg width="100%" height="100%" viewBox="0 0 900 230" style={{ position: "absolute", top: 0, left: 0 }}>
              <line x1="40" y1="190" x2="860" y2="190" stroke="#c7d6cd" strokeWidth="10" />
              <line x1="220" y1="190" x2="150" y2="20" stroke="#c7d6cd" strokeWidth="8" />
              <line x1="620" y1="190" x2="720" y2="20" stroke="#c7d6cd" strokeWidth="8" />
              <circle cx="150" cy="20" r="7" fill="#8fa89c" />
              <circle cx="720" cy="20" r="7" fill="#8fa89c" />
              <circle cx="450" cy="190" r="9" fill="#8fa89c" />
            </svg>
            <div className="map-label" style={{ top: 6, left: 140 }}>Lot A</div>
            <div className="map-label" style={{ top: 6, left: 706 }}>Lot C</div>
            <div className="map-label" style={{ bottom: 6, left: 400 }}>Fairgrounds</div>
            {monitored.map((v) =>
              v.x === null || v.y === null ? null : (
                <div
                  key={v.id}
                  className="marker"
                  title={v.id}
                  style={{ left: v.x, top: v.y, background: statusColor(v) }}
                />
              ),
            )}
          </div>

          <div className="panel-header">
            <span>Monitored vehicles</span>
            <button className="btn-sm" onClick={() => setSwapFor(monitoredIds[monitoredIds.length - 1])}>
              + Add vehicle
            </button>
          </div>
          <div className="panel-body" style={{ marginBottom: 20, padding: 0 }}>
            <table className="data">
              <thead>
                <tr><th>Vehicle</th><th>Lot</th><th>Status</th><th>Swap</th></tr>
              </thead>
              <tbody>
                {monitored.map((v) => (
                  <tr key={v.id}>
                    <td className="veh-id">{v.id}</td>
                    <td>{v.lot}</td>
                    <td className="status-text" style={{ color: statusColor(v) }}>{statusLabel(v)}</td>
                    <td>
                      <button className="btn-sm" aria-label={`Swap ${v.id}`} onClick={() => setSwapFor(v.id)}>
                        ⇆
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {swapFor && (
            <div className="selector-panel">
              <div className="selector-title">Swap in a vehicle for {swapFor}</div>
              {spares.length === 0 ? (
                <div className="selector-empty">No unmonitored vehicles available.</div>
              ) : (
                spares.map((s) => (
                  <button key={s.id} className="selector-option" onClick={() => doSwap(s.id)}>
                    <span>{s.id} · {s.lot}</span>
                    <span className="avail">{s.status === "offline" ? "Offline" : "Available"}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <div className="panel-header"><span>Delay alerts</span></div>
          <div className="alerts-wrap">
            {activeAlerts.length === 0 ? (
              <div className="no-alerts">No delay alerts right now.</div>
            ) : (
              activeAlerts.map((v) => (
                <div className="alert-card" key={v.id}>
                  <div className="alert-top">
                    <span className="alert-veh">{v.id} · {v.lot}</span>
                    <span className="pill-sm pill-danger">+{v.delay} min · {v.conf} confidence</span>
                  </div>
                  <div className="alert-reason">{v.reason}</div>
                  <div className="alert-draft">
                    Draft: &ldquo;{v.lot} shuttle running approximately {v.delay} minutes behind due to
                    traffic. Next pickup delayed.&rdquo;
                  </div>
                  <div className="alert-actions">
                    <button className="btn-post" onClick={() => approve(v)}>Approve and publish</button>
                    <button className="btn-sm" onClick={() => setDismissed((d) => ({ ...d, [v.id]: true }))}>
                      Dismiss
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
