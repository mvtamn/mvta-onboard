import { useEffect, useRef, useState } from "react";
import type { AssessmentPeriod, AssessmentReport } from "@mvta/shared";
import { api } from "../../../config.js";
import { useAppDialog } from "../../../components/AppDialog.js";
import { Empty, formatDate } from "./assessmentFormat.js";

// Report Version counts renders, not issuances: a voided proof keeps its number.
function artifactLabel(report:AssessmentReport):string{if(report.issuance_type==="preliminary")return "Validation Draft";if(report.issued_at)return "Final Assessment";return report.voided_at?"Issuance Proof (voided)":"Issuance Proof"}
export function ReportWorkflow({period,busy,act}:{period:AssessmentPeriod|undefined;busy:boolean;act:(action:()=>Promise<unknown>)=>Promise<void>}){
  const {prompt}=useAppDialog();
  const [reports,setReports]=useState<AssessmentReport[]>([]);
  // The exact archived bytes, opened here before anyone attests to sharing
  // or issues. The api fetches them with the caller's token; an iframe
  // cannot, so the HTML goes in as srcDoc, sandboxed so it can run nothing.
  const [preview,setPreview]=useState<{report:AssessmentReport;html:string}|null>(null);
  const [opened,setOpened]=useState<Set<string>>(new Set());
  const [artifactError,setArtifactError]=useState("");
  const frameRef=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{if(!period){setReports([]);setPreview(null);return}let active=true;api.getAssessmentReports(period.id).then(result=>{if(active)setReports(result.reports)});return()=>{active=false}},[period]);
  // The preview keeps the report it was opened from: after Issue the same row
  // carries the Final's hash, and the bytes on screen are still the proof's.
  const open=async(report:AssessmentReport)=>{setArtifactError("");try{const html=await api.getAssessmentReportHtml(report.id);setPreview({report,html});setOpened(prev=>new Set(prev).add(report.id))}catch(e){setArtifactError(e instanceof Error?e.message:"Unable to open the artifact")}};
  const download=async(report:AssessmentReport)=>{setArtifactError("");try{const blob=await api.getAssessmentReportDownload(report.id);const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`assessment-${period?.service_month??report.period_id}-${report.issuance_type}-v${report.version}.html`;a.click();URL.revokeObjectURL(url)}catch(e){setArtifactError(e instanceof Error?e.message:"Unable to download the artifact")}};
  if(!period)return <Empty>Open this assessment month to work with its official artifacts.</Empty>;
  const draft=reports.find(report=>report.issuance_type==="preliminary"&&!report.issued_at)!,proof=reports.find(report=>report.issuance_type==="final"&&!report.issued_at&&!report.voided_at)!;
  // Nudges, not rules: the server accepts the act either way, but nobody
  // should attest to sharing bytes they have not read, or issue a proof unseen.
  const draftOpened=Boolean(draft&&opened.has(draft.id)),proofOpened=Boolean(proof&&opened.has(proof.id));
  // A period that corrects an issued month must say why on the proof's cover;
  // the server refuses a reason on any other period, so ask only then.
  const prepareProof=async()=>{let reason:string|null=null;if(period.supersedes_period_id){reason=await prompt({title:"Prepare Issuance Proof",label:"Why this Final Assessment supersedes the issued one",confirmLabel:"Prepare proof",multiline:true,required:true});if(!reason)return}void reload(()=>api.createAssessmentReport(period.id,"final",reason??undefined))};
  const reload=async(action:()=>Promise<unknown>)=>{await act(action);const result=await api.getAssessmentReports(period.id);setReports(result.reports)};
  const recordSharing=async()=>{if(!draft)return;const recipient=await prompt({title:"Record draft sharing",label:"Validation Draft recipient",confirmLabel:"Continue",required:true});const attestation=await prompt({title:"Record sender attestation",label:"Sender attestation",confirmLabel:"Record sharing",multiline:true,required:true});if(recipient&&attestation)void reload(()=>api.shareValidationDraft(period.id,draft.id,recipient,attestation))};
  const issueFinal=async()=>{if(!proof)return;const recipient=await prompt({title:"Issue Final Assessment",label:"Final Assessment recipient",confirmLabel:"Continue",required:true});const attestation=await prompt({title:"Record sender attestation",label:"Sender attestation",confirmLabel:"Issue Final Assessment",multiline:true,required:true});if(recipient&&attestation)void reload(()=>api.issueAssessmentReport(proof.id,recipient,attestation))};
  const issued=reports.find(report=>report.issuance_type==="final"&&Boolean(report.issued_at));
  const after=(...statuses:AssessmentPeriod["status"][])=>statuses.includes(period.status);
  const deadline=issued?.dispute_deadline_at?new Date(issued.dispute_deadline_at):null,disputesOpen=Boolean(deadline&&deadline.getTime()>Date.now());
  const step1=after("in_validation","finalized","issued")?"done":period.status==="in_review"?"current":"locked",step2=period.status==="issued"?"done":period.status==="finalized"?"current":"locked",step3=period.status!=="issued"?"locked":disputesOpen?"current":"done";
  const state1=!draft?(step1==="done"?"Shared":"Not generated"):step1==="done"?`v${draft.version} shared`:`v${draft.version} generated`;
  const state2=issued?`Issued ${formatDate(issued.issued_at)}`:proof?`Proof v${proof.version} prepared`:reports.some(report=>report.voided_at)?"Proof voided":"Not prepared";
  const state3=!issued?"Opens on issuance":deadline?`${disputesOpen?"Open until":"Closed"} ${formatDate(issued.dispute_deadline_at)}`:"Open";
  const pill=(step:string)=>step==="done"?"pill-success":step==="current"?"pill-accent":"pill-muted";
  return <section className="assessment-stack">
    <div className="assessment-section-head"><div><h3>Issuance</h3><p>The official package: a Validation Draft shared with the contractor, then the Issuance Proof that becomes the immutable Final Assessment when issued, then the dispute window. Every artifact is content-hashed and every sharing is attested; preparing another proof voids the last.</p></div></div>
    <div className="assessment-steps">
      <div className={`assessment-step-card ${step1}`}><span className="assessment-step-no">1</span><h4>Validation Draft</h4><p>Generated during review. Sharing it with the contractor opens the validation window.</p><div className="assessment-step-state"><span className={`pill-sm ${pill(step1)}`}>{state1}</span></div><div className="assessment-step-actions"><button className="btn-sm" disabled={busy||period.status!=="in_review"} onClick={()=>void reload(()=>api.createAssessmentReport(period.id,"preliminary"))}>{draft?"Regenerate Validation Draft":"Generate Validation Draft"}</button>{draft&&<button className="btn-sm" disabled={busy} onClick={()=>void open(draft)}>Open the draft</button>}<button className="btn-sm" disabled={busy||!draft||!draftOpened||period.status!=="in_review"} title={draft&&!draftOpened?"Open the draft first":undefined} onClick={()=>void recordSharing()}>Record draft sharing</button></div></div>
      <div className={`assessment-step-card ${step2}`}><span className="assessment-step-no">2</span><h4>Final Assessment</h4><p>After the Issuing Authority finalizes the month: prepare the Issuance Proof, read it, then issue it as the Final Assessment.</p><div className="assessment-step-state"><span className={`pill-sm ${pill(step2)}`}>{state2}</span></div><div className="assessment-step-actions"><button className="btn-sm" disabled={busy||period.status!=="finalized"} onClick={()=>void prepareProof()}>{proof?"Prepare a new Issuance Proof":"Prepare Issuance Proof"}</button>{proof&&<button className="btn-sm" disabled={busy} onClick={()=>void open(proof)}>Open the proof</button>}<button className="btn-sm" disabled={busy||!proof||!proofOpened||period.status!=="finalized"} title={proof&&!proofOpened?"Open the Issuance Proof first":undefined} onClick={()=>void issueFinal()}>Issue Final Assessment</button></div></div>
      <div className={`assessment-step-card ${step3}`}><span className="assessment-step-no">3</span><h4>Disputes</h4><p>The contractor may challenge specific items until the deadline. Unchallenged items stay final.</p><div className="assessment-step-state"><span className={`pill-sm ${pill(step3)}`}>{state3}</span></div></div>
    </div>
    <p className="assessment-group-label">Artifacts</p>
    {reports.length?<div className="assessment-table-wrap"><table className="data"><thead><tr><th>Artifact</th><th>Version</th><th>Issued</th><th>Hash</th><th>Open</th></tr></thead><tbody>{reports.map(report=><tr key={report.id} className={report.voided_at?"assessment-voided":undefined}><td>{artifactLabel(report)}{report.supersede_reason?<div className="muted">Supersedes: {report.supersede_reason}</div>:null}</td><td>{report.version}</td><td>{formatDate(report.issued_at)}</td><td><code>{report.content_sha256.slice(0,12)}…</code>{report.proof_sha256?<div className="muted">proof <code>{report.proof_sha256.slice(0,12)}…</code></div>:null}</td><td><button className="btn-sm" disabled={busy} onClick={()=>void open(report)}>Preview</button> {report.voided_at?null:<button className="btn-sm" disabled={busy} onClick={()=>void download(report)}>{report.issued_at?"Download official HTML":report.issuance_type==="preliminary"?"Download draft":"Download proof"}</button>}</td></tr>)}</tbody></table></div>:<Empty>No assessment artifacts have been generated.</Empty>}
    {artifactError&&<div className="assessment-error">{artifactError}</div>}
    {preview&&<div className="assessment-preview"><div className="assessment-section-head"><h4>Archived bytes of {artifactLabel(preview.report)} v{preview.report.version} · SHA-256 <code>{preview.report.content_sha256.slice(0,16)}…</code></h4><div><button className="btn-sm" onClick={()=>frameRef.current?.contentWindow?.print()}>Print convenience copy</button> <button className="btn-sm" onClick={()=>setPreview(null)}>Close</button></div></div><iframe ref={frameRef} title="Assessment artifact preview" sandbox="allow-same-origin allow-modals" srcDoc={preview.html}/></div>}
  </section>;
}
