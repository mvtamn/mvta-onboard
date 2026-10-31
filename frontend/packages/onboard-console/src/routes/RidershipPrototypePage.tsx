// PROTOTYPE ONLY — dev-only home for the ridership prototype, placed where spec §10 puts
// the real module (Specialist Operations › Ridership). Never mounted in a production build.
import { RidershipEntryPrototype } from "./modules/RidershipEntryPrototype.js";

export function RidershipPrototypePage() {
  return (
    <>
      <div className="panel-header">Ridership · PROTOTYPE</div>
      <div className="panel-body"><RidershipEntryPrototype /></div>
    </>
  );
}
