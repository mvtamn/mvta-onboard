import { CHANGELOG_ENTRIES } from "./changelogData.js";

// Changelog - released version history, visible to every signed-in staff
// member (no role gate, same as Dashboard/Compose/etc.) since release notes
// aren't sensitive. Deliberately excludes in-flight/unreleased work - see
// changelogData.ts's header comment.
export function Changelog() {
  return (
    <>
      <div className="panel-header">Changelog</div>
      <div className="panel-body">
        <p className="panel-desc">
          Version history for the MVTA OnBoard staff console and API, newest first.
        </p>
        {CHANGELOG_ENTRIES.map((entry) => (
          <div className="subcard" key={entry.version} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span className="pill-sm pill-success">v{entry.version}</span>
              <span className="td-dim">{entry.date}</span>
            </div>
            {entry.sections.map((section) => (
              <div key={section.heading || "notes"} style={{ marginBottom: 8 }}>
                {section.heading ? (
                  <div className="field-label">{section.heading}</div>
                ) : null}
                <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {section.items.map((item) => (
                    <li key={item} style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 4 }}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
