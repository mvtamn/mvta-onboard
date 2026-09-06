import { EventWorkspaceNav } from "../components/EventWorkspaceNav.js";
import { Admin, DetourContractorSection, DetourReasonCodesSection, EventMonitoringSettingsSection, RouteClassificationSection } from "./Admin.js";
import { AccessManagement } from "./AccessManagement.js";
import { AuditLog } from "./AuditLog.js";
import { EventResourceMapEditor } from "./EventResourceMapEditor.js";
import { Subscribers } from "./Subscribers.js";
import { IntegrationsHealth } from "./modules/IntegrationsHealth.js";

export function AdminAccess() { return <AccessManagement />; }
export function AdminServiceConfiguration() { return <><Admin /><DetourReasonCodesSection /><DetourContractorSection /></>; }
// KPI trust lives here, and only here: one place an administrator reads every
// stream's state, instead of a banner at the top of each module.
export function AdminIntegrations() {
  return <>
    <div className="panel-header">Integrations &amp; Data Health</div>
    <div className="panel-body"><IntegrationsHealth /></div>
  </>;
}
export function AdminGovernance() { return <AuditLog />; }
export function AdminSubscribers() { return <Subscribers />; }

export function AdminEventAdministration() {
  return <>
    <EventWorkspaceNav activeStage="configure" showReturnToPlanning />
    <div id="event-configuration" tabIndex={-1} className="panel-header">Event Administration</div>
    <div className="panel-body"><p className="panel-desc">Maintain reusable resources independently from Event Planning. Active service plans use pinned revisions, so edits do not change live operations until reviewed and applied.</p></div>
    <EventMonitoringSettingsSection />
    <RouteClassificationSection />
    <EventResourceMapEditor />
  </>;
}
