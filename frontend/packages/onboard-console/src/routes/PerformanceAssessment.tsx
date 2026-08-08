import { AssessmentModule } from "./modules/assessment/AssessmentModule.js";

export function PerformanceAssessment() {
  return (
    <>
      <div className="panel-header">Performance Assessment</div>
      <div className="panel-body assessment-page-shell">
        <AssessmentModule />
      </div>
    </>
  );
}
