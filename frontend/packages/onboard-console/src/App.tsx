import { NavLink, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.js";
import { RequireRole } from "./auth/RequireRole.js";
import { useLiveStats } from "./hooks/useLiveStats.js";
import { Sidebar } from "./components/Sidebar.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Compose } from "./routes/Compose.js";
import { ActiveMessages } from "./routes/ActiveMessages.js";
import { SuggestedAlerts } from "./routes/SuggestedAlerts.js";
import { Subscribers } from "./routes/Subscribers.js";
import { AuditLog } from "./routes/AuditLog.js";
import { Admin } from "./routes/Admin.js";
import { OccTools } from "./routes/OccTools.js";

const ADMIN = ["OCC.Admin"] as const;

// Console shell per the approved dashboard mockup: green topbar, tab nav,
// live data-source sidebar, sync footer. Tabs match the mockup's seven, plus
// one Admin-gated "OCC Tools" tab hosting the operational modules.
export function App() {
  const { account, roles, signIn, signOut } = useAuth();
  const isAdmin = roles.includes("OCC.Admin");
  const stats = useLiveStats();

  if (!account) {
    return (
      <div className="frame">
        <div className="topbar">
          <div className="topbar-left">
            <span className="logo-badge">MVTA</span>
            <span className="app-name">OnBoard</span>
            <span className="ver-pill">v1.0.0</span>
          </div>
        </div>
        <div className="signin">
          <h1>MVTA OnBoard Console</h1>
          <p>Staff sign-in required.</p>
          <button className="btn-primary" onClick={signIn}>
            Sign in with Microsoft
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="frame">
      <div className="topbar">
        <div className="topbar-left">
          <span className="logo-badge">MVTA</span>
          <span className="app-name">OnBoard</span>
          <span className="ver-pill">v1.0.0</span>
        </div>
        <div className="topbar-right">
          <span className="tr-text">Session: {new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
          <span className="pill-user">
            {account.name ?? account.username} · {roles.join(", ") || "no roles"}
          </span>
          <button className="btn-signout" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      <nav className="tabnav">
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/compose">Compose</NavLink>
        <NavLink to="/active">Active Messages</NavLink>
        <NavLink to="/suggested">Suggested Alerts</NavLink>
        <NavLink to="/subscribers">Subscribers</NavLink>
        <NavLink to="/audit">Audit Log</NavLink>
        {isAdmin && <NavLink to="/admin">Admin</NavLink>}
        {isAdmin && <NavLink to="/occ">OCC Tools</NavLink>}
      </nav>

      <div className="body-area">
        <Sidebar stats={stats} />
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard onChanged={stats.refresh} />} />
            <Route path="/compose" element={<Compose onChanged={stats.refresh} />} />
            <Route path="/active" element={<ActiveMessages onChanged={stats.refresh} />} />
            <Route path="/suggested" element={<SuggestedAlerts onChanged={stats.refresh} />} />
            <Route path="/subscribers" element={<Subscribers />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route
              path="/admin"
              element={
                <RequireRole allowed={[...ADMIN]}>
                  <Admin />
                </RequireRole>
              }
            />
            <Route
              path="/occ/*"
              element={
                <RequireRole allowed={[...ADMIN]}>
                  <OccTools />
                </RequireRole>
              }
            />
          </Routes>
        </main>
      </div>

      <div className="footer">
        <span>MVTA OnBoard · v1.0.0 · Azure SQL + Service Bus + Entra ID · Internal Use Only</span>
        <span>
          {stats.activeCount ?? "—"} active · {stats.pending?.length ?? "—"} pending alerts · Synced{" "}
          {stats.syncedAt ? stats.syncedAt.toLocaleTimeString() : "—"}
        </span>
      </div>
    </div>
  );
}
