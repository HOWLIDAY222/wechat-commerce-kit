import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMemberOperationsConfig, memberOperationsConfigSchema, validSurveyAnswers } from "@/lib/commerce/member-operations";
import { defaultMemberSurveys, upgradeLegacyMemberSurveys } from "@/lib/commerce/member-surveys";

function legacyConfig() {
  const config = defaultMemberOperationsConfig();
  config.surveys = defaultMemberSurveys().map(survey => survey.id === "UNDERWEAR_SURVEY" ? survey : { ...survey, questions: survey.questions.slice(0, 2) });
  config.surveys[1].title = "风格问卷";
  return config;
}

test("preferences and style contain ten useful server-defined questions with optional private details", () => {
  const surveys = defaultMemberSurveys();
  assert.deepEqual(surveys.map(survey => survey.questions.length), [10, 10, 2]);
  assert(surveys.every(survey => !survey.enabled));
  for (const survey of surveys) {
    assert.equal(new Set(survey.questions.map(question => question.id)).size, survey.questions.length);
    assert(validSurveyAnswers(survey, Object.fromEntries(survey.questions.filter(question => question.required).map(question => [question.id, question.type === "MULTIPLE" ? [question.options[0]] : question.type === "TEXT" ? "实际体验" : question.options[0]]))));
  }
  assert.equal(surveys[0].questions.find(question => question.id === "size")!.required, false);
  assert.equal(surveys[1].questions.find(question => question.id === "budget")!.required, false);
  const config = defaultMemberOperationsConfig(); config.surveys = surveys;
  assert(memberOperationsConfigSchema.safeParse(config).success);
});

test("exact legacy defaults expand without activating tasks, changing rewards or mutating the input", () => {
  const config = legacyConfig(); config.surveys[0].enabled = true; config.tasks.PREFERENCES.enabled = true; config.tasks.PREFERENCES.rewardPoints = 123;
  const before = structuredClone(config); const upgraded = upgradeLegacyMemberSurveys(config);
  assert.deepEqual(config, before);
  assert.deepEqual(upgraded.tasks, before.tasks);
  assert.deepEqual(upgraded.surveys.map(survey => survey.questions.length), [10, 10, 2]);
  assert.equal(upgraded.surveys[0].enabled, true);
  assert.equal(upgraded.surveys[1].title, "风格问卷");
  assert(validSurveyAnswers(upgraded.surveys[0], { fit: "适中", focus: ["透气"] }), "Existing two-answer clients remain valid");
  assert.equal(upgradeLegacyMemberSurveys(upgraded), upgraded, "Upgrading is idempotent");
});

test("merchant-edited questions and existing question order are never overwritten", () => {
  for (const edit of [
    (config: ReturnType<typeof legacyConfig>) => { config.surveys[0].questions[0].title = "商家自己的问题"; },
    (config: ReturnType<typeof legacyConfig>) => { config.surveys[0].questions[0].options.push("商家选项"); },
    (config: ReturnType<typeof legacyConfig>) => { config.surveys[0].questions.reverse(); },
    (config: ReturnType<typeof legacyConfig>) => { config.surveys[0].questions.push({ id: "merchant", title: "补充问题", type: "TEXT", required: false, options: [] }); },
  ]) {
    const config = legacyConfig(); edit(config); const before = structuredClone(config.surveys[0]);
    assert.deepEqual(upgradeLegacyMemberSurveys(config).surveys[0], before);
  }
});

test("all new answer types validate against the actual configured choices", () => {
  const preferences = defaultMemberSurveys()[0];
  const valid = { fit: "适中", focus: ["透气"], cut: "三角", size: "M", waist: "适中包裹", fabric: ["轻薄速干"], scene: ["日常通勤"], concern: ["闷热"], frequency: "没有固定频率", suggestion: "希望接缝更平整" };
  assert(validSurveyAnswers(preferences, valid));
  const invalidPatches: Array<Record<string, string | string[]>> = [{ cut: "任意字符串" }, { size: ["M"] }, { fabric: "轻薄速干" }, { scene: ["日常通勤", "日常通勤"] }, { unknown: "不能保存未知问题" }, { suggestion: "x".repeat(1001) }];
  for (const patch of invalidPatches) {
    assert.equal(validSurveyAnswers(preferences, { ...valid, ...patch }), false);
  }
});
