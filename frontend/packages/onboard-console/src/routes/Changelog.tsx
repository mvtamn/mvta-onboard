import { CHANGELOG_ENTRIES } from "./changelogData.js";

// Changelog - released version history, visible to every signed-in staff
// member (no role gate, same as Dashboard/Compose/etc.) since release notes
// aren't sensitive. Deliberately excludes in-flight/unreleased work - see
// changelogData.ts's header comment.
export function Changelog() {
  return (
    <>
      <div className="panel-header">Release notes</div>
      <div className="panel-body changelog-page">
        <p className="panel-desc">
          What changed in the MVTA OnBoard staff console and API, newest first. You’re using v{__APP_VERSION__}.
        </p>
        <div className="changelog-list">
          {CHANGELOG_ENTRIES.map((entry, index) => {
            const isCurrent = entry.version === __APP_VERSION__;
            return (
              <details className={`changelog-entry${isCurrent ? " is-current" : ""}`} key={entry.version} open={isCurrent || index === 0}>
                <summary>
                  <span className="pill-sm pill-success">v{entry.version}</span>
                  <time dateTime={entry.date}>{entry.date}</time>
                  {isCurrent ? <span className="changelog-current-label">Current version</span> : null}
                </summary>
                <div className="changelog-entry-body">
                  {entry.sections.map((section) => (
                    <section key={section.heading || "notes"}>
                      {section.heading ? <h3>{section.heading}</h3> : null}
                      <ul>
                        {section.items.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </section>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </>
  );
}
