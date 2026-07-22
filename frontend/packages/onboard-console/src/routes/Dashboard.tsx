import { ComposeForm } from "../components/ComposeForm.js";
import { MessagesTable } from "../components/MessagesTable.js";

// Dashboard per the approved mockup: New Announcement panel on top, Active
// Messages table below.
export function Dashboard({ onChanged }: { onChanged?: () => void }) {
  return (
    <>
      <div className="panel-header">New Announcement</div>
      <div className="panel-body">
        <ComposeForm onPosted={onChanged} />
      </div>

      <div className="panel-header">Active Messages</div>
      <div className="panel-body">
        <MessagesTable onChanged={onChanged} />
      </div>
    </>
  );
}
