import { FitAssistant } from "./fit-assistant";
import { X1_FIT_ROWS } from "@/lib/fit-guide";
export const X1_BODY_SIZES = X1_FIT_ROWS.map(row=>({size:row.size,waist:`${row.waistMin}–${row.waistMax}`,weight:`${row.weightMin}–${row.weightMax}`}));

export function X1SizeTable({ english = false }: { english?: boolean }) {
  return <div className="x1-size-table"><FitAssistant english={english}/></div>;
}
