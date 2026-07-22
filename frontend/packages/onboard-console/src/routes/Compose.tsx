import { ComposeForm } from "../components/ComposeForm.js";

export function Compose({ onChanged }: { onChanged?: () => void }) {
  return (
    <>
      <div className="panel-header">Compose Announcement</div>
      <div className="panel-body">
        <ComposeForm onPosted={onChanged} />
      </div>
    </>
  );
}
