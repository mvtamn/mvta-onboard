import { MessagesTable } from "../components/MessagesTable.js";

export function ActiveMessages({ onChanged }: { onChanged?: () => void }) {
  return (
    <>
      <div className="panel-header">Active Messages</div>
      <div className="panel-body">
        <MessagesTable onChanged={onChanged} />
      </div>
    </>
  );
}
