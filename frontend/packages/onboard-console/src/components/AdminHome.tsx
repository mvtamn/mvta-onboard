import { Link } from "react-router-dom";
import { AdminIcon, shortcutLabel } from "./AdminIcon.js";
import { useAdminNav } from "./AdminLayout.js";

// /admin: every area this person can open, each with its pages. The page title
// and subtitle come from the console's top bar.
export function AdminHome() {
  const { areas, openQuickFind } = useAdminNav();
  return (
    <div className="admin-home">
      <button type="button" className="admin-home-find" onClick={openQuickFind}>
        <AdminIcon name="search" size={17} />
        <span>Find a page or tab</span>
        <kbd>{shortcutLabel()}</kbd>
      </button>
      <div className="admin-home-grid">
        {areas.map((area) => (
          <section key={area.id} className="admin-area-card" aria-labelledby={`admin-area-${area.id}`}>
            <header>
              <span className="admin-area-icon"><AdminIcon name={area.icon} size={19} /></span>
              <h2 id={`admin-area-${area.id}`}>{area.name}</h2>
            </header>
            <ul>
              {area.pages.map((page) => (
                <li key={page.to}>
                  <Link to={page.to}>
                    <span className="admin-area-page"><b>{page.label}</b><small>{page.desc}</small></span>
                    <AdminIcon name="chevron" size={16} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
