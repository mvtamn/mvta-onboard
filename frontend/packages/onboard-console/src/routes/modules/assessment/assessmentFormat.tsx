import type React from "react";

// Formatting shared by the assessment module and the pages split out of it.
export const money=(v:number|null|undefined)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v??0);
export const formatDate=(value:string|null|undefined)=>{if(!value)return "—";const digits=value.replace(/\D/g,"");if(digits.length<8)return value;return `${digits.slice(4,6)}/${digits.slice(6,8)}/${digits.slice(0,4)}`};
export const formatMonth=(value:string)=>value.length===6?new Date(Number(value.slice(0,4)),Number(value.slice(4,6))-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}):value;
export const Empty=({children}:{children:React.ReactNode})=><div className="assessment-empty">{children}</div>;
