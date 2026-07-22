import { NavLink, Route, Routes } from "react-router-dom";
import { ServiceAlerts } from "./routes/ServiceAlerts.js";
import { OptIn } from "./routes/OptIn.js";

export function App() {
  return (
    <div className="frame">
      <div className="alertbar">
        &#9888; Service alerts &nbsp;|&nbsp; Real-time updates from MVTA OnBoard
      </div>
      <nav className="nav">
        <div className="logo">
          <span style={{ color: "#00553D" }}>M</span>
          <span style={{ color: "#639281" }}>V</span>
          <span style={{ color: "#F78E1E" }}>TA</span>
        </div>
        <div className="navlinks">
          <NavLink to="/">Service Alerts</NavLink>
          <NavLink to="/subscribe">Get Notified</NavLink>
        </div>
      </nav>
      <div className="content">
        <Routes>
          <Route path="/" element={<ServiceAlerts />} />
          <Route path="/subscribe" element={<OptIn />} />
        </Routes>
      </div>
    </div>
  );
}
