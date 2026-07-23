import { ComposeForm } from "../components/ComposeForm.js";
import { MessagesTable } from "../components/MessagesTable.js";
import { Sidebar } from "../components/Sidebar.js";
import type { LiveStats } from "../hooks/useLiveStats.js";

// Dashboard: New Announcement + Active Messages in the primary column, with
// the live data-source panel as a contextual right rail (this is the one page
// that shows it, matching the reference's page-specific context panel — the
// sidebar is nav everywhere else). `stats` comes from App.tsx's single
// useLiveStats() instance (also drives the nav footer) rather than polling
// again here.
export function Dashboard({ stats, onChanged }: { stats: LiveStats; onChanged?: () => void }) {
  function refreshAll() {
    stats.refresh();
    onChanged?.();
  }

  return (
    <div className="content-layout">
      <div className="content-primary">
        <div className="panel-header">New Announcement</div>
        <div className="panel-body">
          <ComposeForm onPosted={refreshAll} />
        </div>

        <div className="panel-header">Active Messages</div>
        <div className="panel-body">
          <MessagesTable onChanged={refreshAll} />
        </div>
      </div>

      <div className="content-rail">
        <Sidebar stats={stats} />
      </div>
    </div>
  );
}
