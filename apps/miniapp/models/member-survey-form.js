export function surveyAnswerValid(question, value) {
  if (value === undefined || value === '' || Array.isArray(value) && value.length === 0) return !question.required;
  if (question.type === 'TEXT') return typeof value === 'string' && value.trim().length <= 1000 && (!question.required || !!value.trim());
  if (question.type === 'SINGLE') return typeof value === 'string' && question.options.includes(value);
  return Array.isArray(value) && new Set(value).size === value.length && value.every(option => question.options.includes(option));
}

export function surveyAnswerPresent(value) {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && !!value.trim();
}

export function surveyFormPresentation(survey, answers, index, reviewing) {
  const questions = survey?.questions || [];
  const currentIndex = Math.max(0, Math.min(index, Math.max(questions.length - 1, 0)));
  const current = questions[currentIndex];
  const currentQuestion = current ? { ...current, ordinal: currentIndex + 1,
    typeLabel: current.type === 'MULTIPLE' ? '可多选' : current.type === 'TEXT' ? '文字回答' : '请选择一项',
    answerText: typeof answers[current.id] === 'string' ? answers[current.id] : '',
    choices: (current.options || []).map(option => ({ value: option, selected: Array.isArray(answers[current.id]) ? answers[current.id].includes(option) : answers[current.id] === option })),
  } : null;
  return { stepIndex: currentIndex, currentQuestion, questionCount: questions.length,
    stepLabel: reviewing ? '确认回答' : `第 ${currentIndex + 1} 题 / 共 ${questions.length} 题`,
    progressPercent: questions.length ? Math.round((reviewing ? questions.length : currentIndex + 1) / questions.length * 100) : 0,
    answeredCount: questions.filter(question => surveyAnswerPresent(answers[question.id])).length,
    reviewAnswers: questions.map((question, questionIndex) => ({ id: question.id, title: question.title, index: questionIndex,
      answer: Array.isArray(answers[question.id]) ? answers[question.id].join('、') : typeof answers[question.id] === 'string' ? answers[question.id].trim() || '未填写' : '未填写' })),
  };
}
