/** Course structure, validation and the completion/unlock engine. Pure functions over a course definition and a learner's progress record. */

export const ITEM_TYPES = ['reading', 'quiz', 'assignment'];

/** Returns a list of problems; an empty list means the course is well-formed. */
export function validateCourse(course) {
  const p = [];
  if (!course || typeof course !== 'object') return ['course must be an object'];
  if (!course.id) p.push('course needs an id');
  if (!course.title) p.push('course needs a title');
  if (!Array.isArray(course.modules) || course.modules.length === 0) return [...p, 'course needs at least one module'];
  const ids = new Set();
  course.modules.forEach((m, mi) => {
    const where = `module ${mi + 1}`;
    if (!m.id) p.push(`${where}: needs an id`);
    if (ids.has(m.id)) p.push(`${where}: duplicate id "${m.id}"`);
    ids.add(m.id);
    if (!m.title) p.push(`${where}: needs a title`);
    if (!Array.isArray(m.items) || m.items.length === 0) p.push(`${where}: needs at least one item`);
    for (const it of m.items ?? []) {
      const w = `${where} item "${it.id ?? '?'}"`;
      if (!it.id) p.push(`${where}: item needs an id`);
      if (ids.has(it.id)) p.push(`${w}: duplicate id`);
      ids.add(it.id);
      if (!ITEM_TYPES.includes(it.type)) p.push(`${w}: unknown type "${it.type}"`);
      if (it.type === 'quiz') {
        if (!Array.isArray(it.items) || it.items.length === 0) p.push(`${w}: quiz needs items`);
        for (const q of it.items ?? []) {
          if (!q.id || !q.prompt || !Array.isArray(q.choices) || q.choices.length < 2) p.push(`${w}: question "${q.id ?? '?'}" needs id, prompt and 2+ choices`);
          else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) p.push(`${w}: question "${q.id}" answer index out of range`);
        }
        if (it.passMark !== undefined && !(it.passMark >= 0 && it.passMark <= 1)) p.push(`${w}: passMark must be 0–1`);
      }
      if (it.type === 'assignment' && !(it.points > 0)) p.push(`${w}: assignment needs points > 0`);
      if (it.type === 'reading' && !it.body) p.push(`${w}: reading needs a body`);
    }
    if (m.requires && !course.modules.slice(0, mi).some((x) => x.id === m.requires)) p.push(`${where}: requires "${m.requires}" which is not an earlier module`);
  });
  return p;
}

export function allItems(course) {
  return course.modules.flatMap((m) => m.items.map((it) => ({ ...it, moduleId: m.id })));
}

/** An item is complete when progress records it: readings when opened, quizzes when passed, assignments when submitted. */
export function isItemComplete(item, progress) {
  const rec = progress.items?.[item.id];
  if (!rec) return false;
  if (item.type === 'reading') return Boolean(rec.opened);
  if (item.type === 'quiz') return rec.bestScaled !== undefined && rec.bestScaled >= (item.passMark ?? 0.7);
  if (item.type === 'assignment') return Boolean(rec.submittedAt);
  return false;
}

export function moduleState(course, moduleId, progress) {
  const m = course.modules.find((x) => x.id === moduleId);
  const done = m.items.filter((it) => isItemComplete(it, progress)).length;
  const complete = done === m.items.length;
  const unlocked = !m.requires || moduleState(course, m.requires, progress).complete;
  return { id: m.id, total: m.items.length, done, complete, unlocked };
}

export function courseProgress(course, progress) {
  const states = course.modules.map((m) => moduleState(course, m.id, progress));
  const total = states.reduce((s, x) => s + x.total, 0);
  const done = states.reduce((s, x) => s + x.done, 0);
  return { modules: states, total, done, pct: total ? (done / total) * 100 : 0, complete: total > 0 && done === total };
}

/** Next incomplete item in an unlocked module, or null when the course is complete. */
export function nextItem(course, progress) {
  for (const m of course.modules) {
    const st = moduleState(course, m.id, progress);
    if (!st.unlocked) continue;
    const it = m.items.find((x) => !isItemComplete(x, progress));
    if (it) return { ...it, moduleId: m.id };
  }
  return null;
}

/** Scores a quiz attempt: answers is { questionId: choiceIndex }. Unanswered counts as wrong. */
export function scoreQuiz(quiz, answers) {
  const results = quiz.items.map((q) => ({ id: q.id, chosen: answers[q.id] ?? null, correct: answers[q.id] === q.answer }));
  const raw = results.filter((r) => r.correct).length;
  const max = quiz.items.length;
  const scaled = max ? raw / max : 0;
  return { raw, max, scaled, passed: scaled >= (quiz.passMark ?? 0.7), results };
}

/** Pure state transitions on the progress record. */
export function recordOpened(progress, itemId, at) {
  const items = { ...progress.items, [itemId]: { ...progress.items?.[itemId], opened: true, openedAt: progress.items?.[itemId]?.openedAt ?? at } };
  return { ...progress, items };
}
export function recordQuizAttempt(progress, itemId, score, at) {
  const prev = progress.items?.[itemId] ?? {};
  const attempts = (prev.attempts ?? 0) + 1;
  const bestScaled = Math.max(prev.bestScaled ?? 0, score.scaled);
  return { ...progress, items: { ...progress.items, [itemId]: { ...prev, attempts, lastScaled: score.scaled, bestScaled, lastAt: at } } };
}
export function recordSubmission(progress, itemId, text, at) {
  const prev = progress.items?.[itemId] ?? {};
  return { ...progress, items: { ...progress.items, [itemId]: { ...prev, submittedAt: at, text, words: text.trim() ? text.trim().split(/\s+/).length : 0 } } };
}
