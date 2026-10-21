import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage } from '../../utils/member-operations-page';
import { surveyQuestions } from '../../models/member-operations';
import { surveyAnswerValid, surveyFormPresentation } from '../../models/member-survey-form';

Page(withTapFeedback({
  ...operationsPage({ route: '/pages/member-surveys/index', initialize(options) {
    if (typeof options.id === 'string' && /^[A-Z_]{1,60}$/.test(options.id)) {
      this.setData({ selectedId: options.id });
      this.returnRoute = '/pages/member-surveys/index?id=' + encodeURIComponent(options.id);
    }
  }, loaded() { this.refreshSurvey(); } }),
  data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '',
    selectedId: '', selected: null, questions: [], answers: {}, confirmed: false, stepIndex: 0, reviewing: false,
    currentQuestion: null, questionCount: 0, stepLabel: '', progressPercent: 0, answeredCount: 0, reviewAnswers: [] },
  refreshSurvey() {
    const selected = this.data.overview?.surveys?.find(item => item.id === this.data.selectedId) || null;
    let answers = this.data.answers;
    if (selected && this.data.selected?.id === selected.id && JSON.stringify(selected.questions) !== JSON.stringify(this.data.selected.questions)) {
      answers = {};
      this.setData({ stepIndex: 0, reviewing: false, confirmed: false, notice: '问题已更新，请按当前题目重新核对回答。' });
    }
    this.setData({ selected, answers, questions: surveyQuestions(selected, answers),
      ...surveyFormPresentation(selected, answers, this.data.stepIndex, this.data.reviewing) });
  },
  selectSurvey(event) {
    this.setData({ selectedId: event.currentTarget.dataset.id, answers: {}, confirmed: false, stepIndex: 0, reviewing: false, error: '', notice: '' });
    this.refreshSurvey();
  },
  closeSurvey() {
    if (this.data.busy) return;
    this.setData({ selectedId: '', selected: null, questions: [], answers: {}, confirmed: false, stepIndex: 0, reviewing: false, currentQuestion: null, error: '', notice: '' });
  },
  changeAnswer(event) {
    const id = event.currentTarget.dataset.id;
    const question = this.data.selected?.questions?.find(item => item.id === id);
    if (!question || !this.data.selected.enabled || this.data.selected.completed || this.data.busy) return;
    const value = event.detail.value;
    if (!surveyAnswerValid({ ...question, required: false }, value)) return;
    this.setData({ answers: { ...this.data.answers, [id]: value }, confirmed: false, error: '' });
    this.refreshSurvey();
  },
  nextQuestion() {
    if (this.data.busy || !this.data.currentQuestion) return;
    const question = this.data.currentQuestion;
    if (this.data.selected.enabled && !this.data.selected.completed && !surveyAnswerValid(question, this.data.answers[question.id])) {
      this.setData({ error: question.type === 'MULTIPLE' ? '请至少选择一项，再继续。' : question.type === 'TEXT' ? '请填写这一题，再继续。' : '请选择一项，再继续。' });
      return;
    }
    const reviewing = this.data.stepIndex >= this.data.questionCount - 1;
    this.setData({ reviewing, stepIndex: reviewing ? this.data.stepIndex : this.data.stepIndex + 1, error: '' });
    this.refreshSurvey();
    if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 180 });
  },
  previousQuestion() {
    if (this.data.busy) return;
    this.setData({ reviewing: false, stepIndex: this.data.reviewing ? this.data.stepIndex : Math.max(0, this.data.stepIndex - 1), error: '' });
    this.refreshSurvey();
  },
  skipQuestion() {
    const question = this.data.currentQuestion;
    if (!question || question.required || this.data.busy) return;
    const answers = { ...this.data.answers }; delete answers[question.id];
    this.setData({ answers, confirmed: false, error: '' });
    this.nextQuestion();
  },
  editQuestion(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.questionCount || this.data.busy) return;
    this.setData({ stepIndex: index, reviewing: false, error: '' }); this.refreshSurvey();
  },
  changeConsent(event) { this.setData({ confirmed: event.detail.value.includes('confirmed') }); },
  async submit() {
    const survey = this.data.selected;
    if (!survey?.enabled || survey.completed || !this.data.confirmed) return;
    const answers = this.data.answers;
    const missing = survey.questions.findIndex(question => !surveyAnswerValid(question, answers[question.id]));
    if (missing >= 0) {
      this.setData({ stepIndex: missing, reviewing: false, error: '请核对这一题的回答。' }); this.refreshSurvey(); return;
    }
    await this.performOperation('submit_survey', { surveyId: survey.id, answers }, '问卷已保存，完成状态和积分以最新记录为准。');
  },
}, ["goLogin","loadOperations","joinMember","selectSurvey","closeSurvey","editQuestion","previousQuestion","nextQuestion","submit","skipQuestion"]));
