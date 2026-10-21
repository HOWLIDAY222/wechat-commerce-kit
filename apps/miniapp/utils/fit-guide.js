// Generated from the website lib/fit-guide.ts. Keep both clients on the same size reference.
export const FIT_CONSENT_VERSION = "fit-profile-2026-10-14";
export const X1_FIT_ROWS = [
    { size: "S", waistMin: 64, waistMax: 72, weightMin: 45, weightMax: 60 },
    { size: "M", waistMin: 72, waistMax: 80, weightMin: 55, weightMax: 65 },
    { size: "L", waistMin: 80, waistMax: 88, weightMin: 65, weightMax: 75 },
];
export function recommendX1Fit(values) {
    const waist = values.waistCm, weight = values.weightKg;
    const validWaist = typeof waist === "number" && Number.isFinite(waist) && waist >= 40 && waist <= 200;
    const validWeight = typeof weight === "number" && Number.isFinite(weight) && weight >= 20 && weight <= 300;
    if (!validWaist) {
        const candidates = validWeight ? X1_FIT_ROWS.filter(row => weight >= row.weightMin && weight <= row.weightMax).map(row => row.size) : [];
        return { recommended: null, candidates, status: validWeight ? "weight-reference" : "empty", weightMismatch: false };
    }
    const matching = X1_FIT_ROWS.filter(row => waist >= row.waistMin && waist <= row.waistMax);
    if (!matching.length)
        return { recommended: null, candidates: [], status: "outside", weightMismatch: false };
    const selected = values.preference === "relaxed" ? matching[matching.length - 1] : matching[0];
    return { recommended: selected.size, candidates: matching.map(row => row.size), status: matching.length > 1 ? "boundary" : "waist", weightMismatch: validWeight && (weight < selected.weightMin || weight > selected.weightMax) };
}
export function parseFitFields(fields) {
    function optional(value, min, max) {
        if (value === "" || value === null || value === undefined)
            return null;
        if (typeof value !== "number" && (typeof value !== "string" || !/^\d+(?:\.\d)?$/.test(value.trim())))
            throw Error("INVALID_FIT_PROFILE");
        const number = Number(value);
        if (!Number.isFinite(number) || number < min || number > max || Math.abs(number * 10 - Math.round(number * 10)) > 0.00001)
            throw Error("INVALID_FIT_PROFILE");
        return number;
    }
    if (fields.preference !== undefined && !["regular", "relaxed"].includes(String(fields.preference)))
        throw Error("INVALID_FIT_PROFILE");
    return { heightCm: optional(fields.heightCm, 50, 250), weightKg: optional(fields.weightKg, 20, 300), waistCm: optional(fields.waistCm, 40, 200), preference: fields.preference === "relaxed" ? "relaxed" : "regular" };
}
export function fitMessage(result, english = false) {
    if (result.status === "outside")
        return english ? "Your waist is outside our published size range. Contact us before choosing a size." : "腰围超出现有尺码表范围，请先联系客服确认，不建议直接下单。";
    if (result.status === "empty")
        return english ? "Enter your waist to highlight a reference size." : "填写腰围，实时查看参考尺码。";
    if (result.status === "weight-reference")
        return english ? "Weight alone is a rough reference. Add your waist before choosing a size." : "体重只能作粗略参考，请补充腰围后再选码。";
    const base = english ? `Reference size: ${result.recommended}.` : `参考 ${result.recommended} 码。`;
    return base + (result.status === "boundary" ? (english ? " You are between sizes; the highlighted choice follows your fit preference." : "处于两码交界，已结合你的松紧偏好高亮。") : "") + (result.weightMismatch ? (english ? " Your weight differs from this row; body shape may affect fit. Ask us if unsure." : "体重与该行参考范围有差异，体型会影响贴合，拿不准时请先咨询。") : "");
}
