import { CHANGELOG_ENTRIES } from "./changelogData.js";

// Changelog - released version history, visible to every signed-in staff
// member (no role gate, same as Dashboard/Compose/etc.) since release notes
// aren't sensitive. Deliberately excludes in-flight/unreleased work - see
// changelogData.ts's header comment.
export function Changelog() {
  return (
    <div className="panel-body changelog-page">
      <header className="changelog-hero">
        <div>
          <span className="changelog-eyebrow">Product updates</span>
          <h2>Release notes</h2>
          <p>What changed in the MVTA OnBoard staff console and API, newest first.</p>
        </div>
        <div className="changelog-build" aria-label={`Current build version ${__APP_VERSION__}`}>
          <span>Current build</span>
          <strong>v{__APP_VERSION__}</strong>
        </div>
      </header>
      <div className="changelog-list" aria-label="Release history">
        {CHANGELOG_ENTRIES.map((entry, index) => {
          const isCurrent = entry.version === __APP_VERSION__;
          return (
            <details className={`changelog-entry${isCurrent ? " is-current" : ""}`} key={entry.version} open={isCurrent || index === 0}>
              <summary>
                <span className="changelog-version">v{entry.version}</span>
                <span className="changelog-entry-meta">
                  <time dateTime={entry.date}>{entry.date}</time>
                  {isCurrent ? <span className="changelog-current-label">Current</span> : null}
                </span>
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
  );
}
