const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

function setup(patch = {}) {
  const calls = [];
  let value = { ok: true, registered: true, pointsBalance: 100, ruleVersion: 2, tasks: [], lotteries: [], posts: [],
    surveys: [{ id: 'PREFERENCES', title: '穿着偏好', enabled: true, completed: false, rewardPoints: 100, questions: [
      { id: 'fit', title: '穿着感受', type: 'SINGLE', required: true, options: ['贴身', '适中'] },
      { id: 'focus', title: '关注点', type: 'MULTIPLE', required: true, options: ['柔软', '透气'] },
      { id: 'note', title: '补充', type: 'TEXT', required: false, options: [] },
    ] }], ...patch };
  const storage = new Map([['merchantkit.session', { accessToken: 'local-only', expiresAt: '2099-01-01' }], ['merchantkit.user', { id: 'SURVEY-LOCAL-ONLY' }]]);
  const wx = { getStorageSync: key => storage.get(key), pageScrollTo() {} };
  const service = { fetchMemberOperations: async () => structuredClone(value), memberOperation: async (action, payload) => {
    calls.push({ action, payload: structuredClone(payload) });
    value.surveys[0].completed = true;
    return { ok: true, completed: true, rewardPoints: 100 };
  } };
  const loader = createLoader(wx, { [path.join(root, 'services/member-operations.js')]: service });
  loader.load('pages/member-surveys/index.js');
  const page = loader.page; page.data = structuredClone(page.data); page.setData = patch => Object.assign(page.data, patch); page.onLoad({ id: 'PREFERENCES' });
  return { page, calls, value, loader };
}
const answer = (page, id, value) => page.changeAnswer({ currentTarget: { dataset: { id } }, detail: { value } });

test('stepper blocks missing required answer and presents one active question', async () => {
  const { page, calls } = setup(); await page.loadOperations();
  assert.equal(page.data.questionCount, 3); assert.equal(page.data.currentQuestion.id, 'fit');
  page.nextQuestion(); assert.equal(page.data.stepIndex, 0); assert.match(page.data.error, /请选择/);
  answer(page, 'fit', '适中'); page.nextQuestion(); assert.equal(page.data.currentQuestion.id, 'focus');
  assert.equal(calls.length, 0); assert.equal(page.data.progressPercent, 67);
});

test('selection cards keep answers across back navigation and reject invented choices or shapes', async () => {
  const { page } = setup(); await page.loadOperations();
  answer(page, 'fit', '适中'); page.nextQuestion(); answer(page, 'focus', ['透气']); page.previousQuestion();
  assert.equal(page.data.currentQuestion.choices.find(choice => choice.value === '适中').selected, true);
  answer(page, 'fit', ['适中']); assert.equal(page.data.answers.fit, '适中');
  answer(page, 'fit', '伪造选项'); assert.equal(page.data.answers.fit, '适中');
  answer(page, 'focus', ['透气', '透气']); assert.deepEqual(Array.from(page.data.answers.focus), ['透气']);
});

test('optional text may be skipped and only final confirmation sends the real answer object', async () => {
  const { page, calls } = setup(); await page.loadOperations();
  answer(page, 'fit', '适中'); page.nextQuestion(); answer(page, 'focus', ['柔软', '透气']); page.nextQuestion();
  answer(page, 'note', '准备跳过的草稿'); page.skipQuestion();
  assert.equal(page.data.reviewing, true); assert.equal(page.data.answers.note, undefined); assert.equal(calls.length, 0);
  await page.submit(); assert.equal(calls.length, 0);
  page.changeConsent({ detail: { value: ['confirmed'] } }); await page.submit();
  assert.deepEqual(calls, [{ action: 'submit_survey', payload: { surveyId: 'PREFERENCES', answers: { fit: '适中', focus: ['柔软', '透气'] } } }]);
  assert.equal(page.data.selected.completed, true); await page.submit(); assert.equal(calls.length, 1);
});

test('editing an answer cancels old confirmation and review can jump to the chosen question', async () => {
  const { page } = setup(); await page.loadOperations(); answer(page, 'fit', '贴身'); answer(page, 'focus', ['透气']);
  page.setData({ reviewing: true, confirmed: true }); page.editQuestion({ currentTarget: { dataset: { index: 0 } } });
  answer(page, 'fit', '适中'); assert.equal(page.data.confirmed, false); assert.equal(page.data.stepIndex, 0); assert.equal(page.data.reviewing, false);
});

test('changed server questions reset a pending draft instead of submitting stale answers', async () => {
  const { page, value, calls } = setup(); await page.loadOperations(); answer(page, 'fit', '贴身');
  value.surveys[0].questions[0].options = ['新的选项', '另一项']; await page.loadOperations();
  assert.equal(Object.keys(page.data.answers).length, 0); assert.equal(page.data.confirmed, false); assert.match(page.data.notice, /问题已更新/); assert.equal(calls.length, 0);
});

test('completed and disabled questionnaires browse without collecting answers or submitting rewards', async () => {
  for (const state of [{ enabled: false }, { completed: true }]) {
    const { page, calls, value } = setup(); Object.assign(value.surveys[0], state); await page.loadOperations();
    answer(page, 'fit', '适中'); page.nextQuestion(); page.nextQuestion(); page.nextQuestion();
    assert.equal(page.data.reviewing, true); assert.equal(Object.keys(page.data.answers).length, 0);
    page.setData({ confirmed: true }); await page.submit(); assert.equal(calls.length, 0);
  }
});

test('text input length is validated independently of the visual maxlength', () => {
  const { loader } = setup(); const { surveyAnswerValid } = loader.load('models/member-survey-form.js');
  const required = { type: 'TEXT', required: true, options: [] };
  assert.equal(surveyAnswerValid(required, '   '), false); assert.equal(surveyAnswerValid(required, 'x'.repeat(1001)), false);
  assert.equal(surveyAnswerValid({ ...required, required: false }, ''), true);
});
