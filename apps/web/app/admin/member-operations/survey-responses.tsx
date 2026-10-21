import type { MemberOperationsConfig } from "@/lib/commerce/member-operations";

type SavedRecord = { id: string; kind: string; userId: string; payload: Record<string, unknown>; createdAt: string };
function answerRows(record: SavedRecord, config: MemberOperationsConfig) {
  const rawAnswers = record.payload.answers;
  const answers = rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers) ? rawAnswers as Record<string, unknown> : {};
  const snapshot = Array.isArray(record.payload.questions) ? record.payload.questions : config.surveys.find(survey => survey.id === record.payload.surveyId)?.questions || [];
  return Object.entries(answers).map(([id, value]) => {
    const question = snapshot.find(item => item && typeof item === "object" && "id" in item && item.id === id);
    return { id, title: question && typeof question === "object" && "title" in question && typeof question.title === "string" ? question.title : id,
      answer: Array.isArray(value) ? value.filter(item => typeof item === "string").join("、") : typeof value === "string" ? value : "" };
  });
}

/** Reads the server's saved SURVEY records. It does not infer task completion or issue rewards. */
export function SurveyResponses({ records, config }: { records: SavedRecord[]; config: MemberOperationsConfig }) {
  const surveys = records.filter(record => record.kind === "SURVEY");
  return <section className="rounded-xl border border-[#dedede] bg-white p-5">
    <h2 className="text-lg font-semibold">会员问卷回答</h2>
    <p className="mt-2 text-sm leading-6 text-[#707070]">查看会员实际提交的回答。修改题目不会重置已完成记录，也不会补发积分。</p>
    {surveys.length ? <div className="mt-5 grid gap-4">{surveys.map(record => <details className="rounded-lg border border-[#e5e5e5] p-4" key={record.id}>
      <summary className="cursor-pointer font-medium">{String(record.payload.title || "会员问卷")}<span className="ml-3 text-xs font-normal text-[#777]">{new Date(record.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</span></summary>
      <a className="mt-3 inline-block text-sm underline" href={`/admin/users/${encodeURIComponent(record.userId)}`}>查看会员档案</a>
      <dl className="mt-4 grid gap-5">{answerRows(record, config).map(row => <div key={row.id}><dt className="text-sm text-[#777]">{row.title}</dt><dd className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{row.answer || "未填写"}</dd></div>)}</dl>
    </details>)}</div> : <p className="mt-5 rounded-lg bg-[#f5f5f5] p-4 text-sm text-[#777]">尚无已提交的问卷回答。</p>}
  </section>;
}
