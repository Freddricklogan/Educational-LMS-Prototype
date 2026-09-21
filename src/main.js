/** Binds the course engine, gradebook, xAPI log and cohort analytics to the page and the Executive Shell. */
import { cohortSummary, evaluateLearner, evaluationsCsv, itemAccess, THRESHOLDS, TIER_LABELS, weeklyActiveShare, weeklyActivity } from './analytics.js';
import { loadChartLib, makeCharts } from './charts.js';
import { courseProgress, isItemComplete, moduleState, nextItem, recordOpened, recordQuizAttempt, recordSubmission, scoreQuiz, validateCourse } from './course.js';
import { mountExecShell } from './exec-shell.js';
import { computeGrade, neededForTarget, parseGradesCsv } from './gradebook.js';
import { $, el, setText } from './ui.js';
import { statement, TYPES, uuid } from './xapi.js';

const KEY = 'lms-prototype-v1';
const state = { course: null, cohort: null, progress: { items: {} }, statements: [], actor: null, current: null, answers: {}, role: 'learner' };
let charts = makeCharts(null);
let shell;
const now = () => new Date().toISOString();
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw?.progress) state.progress = raw.progress;
    if (Array.isArray(raw?.statements)) state.statements = raw.statements;
    if (raw?.actor) state.actor = raw.actor;
  } catch { /* storage unavailable or corrupt: start clean */ }
  if (!state.actor) state.actor = { homePage: 'https://freddricklogan.github.io/Educational-LMS-Prototype/', name: `learner-${uuid().slice(0, 8)}` };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ progress: state.progress, statements: state.statements.slice(-500), actor: state.actor })); } catch { /* ignore */ }
}
function log(verb, item, type, result) {
  state.statements.push(statement({ actor: state.actor, verb, objectId: `${state.actor.homePage}course/${state.course.id}/${item.id}`, name: item.title, type, result, timestamp: now() }));
  save();
}

function renderOutline() {
  const list = $('outline');
  list.replaceChildren();
  const prog = courseProgress(state.course, state.progress);
  for (const m of state.course.modules) {
    const st = moduleState(state.course, m.id, state.progress);
    const li = el('li', { class: `module ${st.unlocked ? '' : 'is-locked'} ${st.complete ? 'is-complete' : ''}` });
    const h = el('h3');
    h.append(el('span', { text: m.title }), el('span', { class: 'module-state', text: st.unlocked ? `${st.done}/${st.total}` : `locked · complete “${state.course.modules.find((x) => x.id === m.requires)?.title}” first` }));
    li.append(h);
    const ul = el('ul', { class: 'items' });
    for (const it of m.items) {
      const done = isItemComplete(it, state.progress);
      const b = el('button', { type: 'button', class: `item-btn type-${it.type} ${done ? 'is-done' : ''} ${state.current?.id === it.id ? 'is-current' : ''}`, 'aria-pressed': state.current?.id === it.id ? 'true' : 'false' });
      b.textContent = `${it.type === 'reading' ? 'Read' : it.type === 'quiz' ? 'Quiz' : 'Assignment'} · ${it.title}${done ? ' ✓' : ''}`;
      b.disabled = !st.unlocked;
      b.addEventListener('click', () => openItem(it, m));
      ul.append(el('li', {}, [b]));
    }
    li.append(ul);
    list.append(li);
  }
  setText('progress-text', `${prog.done} of ${prog.total} items · ${prog.pct.toFixed(0)}%`);
  $('progress-bar').value = prog.pct;
  const next = nextItem(state.course, state.progress);
  setText('next-text', next ? `Next: ${next.title}` : 'Course complete.');
}

function openItem(it, m) {
  state.current = { ...it, moduleId: m.id };
  state.answers = {};
  const view = $('item-view');
  view.replaceChildren();
  view.append(el('p', { class: 'crumb', text: `${m.title}` }), el('h2', { text: it.title }));
  if (it.type === 'reading') {
    view.append(el('p', { class: 'meta', text: `About ${it.minutes} minutes` }));
    for (const para of it.body.split('\n\n')) view.append(el('p', { text: para }));
    if (!state.progress.items[it.id]?.opened) {
      state.progress = recordOpened(state.progress, it.id, now());
      log('experienced', it, TYPES.lesson);
    }
    const done = el('button', { type: 'button', class: 'btn btn--primary', text: 'Mark as read and continue' });
    done.addEventListener('click', () => { const n = nextItem(state.course, state.progress); if (n) openItem(n, state.course.modules.find((x) => x.id === n.moduleId)); renderAll(); });
    view.append(done);
  } else if (it.type === 'quiz') {
    const rec = state.progress.items[it.id];
    view.append(el('p', { class: 'meta', text: `${it.items.length} questions · pass mark ${((it.passMark ?? 0.7) * 100).toFixed(0)}%${rec?.attempts ? ` · attempts ${rec.attempts}, best ${(rec.bestScaled * 100).toFixed(0)}%` : ''}` }));
    log('attempted', it, TYPES.assessment);
    const form = el('form', { class: 'quiz' });
    it.items.forEach((q, qi) => {
      const fs = el('fieldset');
      fs.append(el('legend', { text: `${qi + 1}. ${q.prompt}` }));
      q.choices.forEach((c, ci) => {
        const id = `${it.id}-${q.id}-${ci}`;
        const input = el('input', { type: 'radio', name: q.id, id, value: String(ci) });
        input.addEventListener('change', () => { state.answers[q.id] = ci; });
        fs.append(el('div', { class: 'choice' }, [input, el('label', { for: id, text: c })]));
      });
      form.append(fs);
    });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Submit answers' });
    const out = el('p', { class: 'result', 'aria-live': 'polite' });
    form.append(submit, out);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const score = scoreQuiz(it, state.answers);
      state.progress = recordQuizAttempt(state.progress, it.id, score, now());
      for (const r of score.results) log('answered', { id: `${it.id}/${r.id}`, title: it.items.find((q) => q.id === r.id).prompt }, TYPES.question, { success: r.correct, response: r.chosen === null ? '' : String(r.chosen) });
      log(score.passed ? 'passed' : 'failed', it, TYPES.assessment, { success: score.passed, completion: true, score: { scaled: score.scaled, raw: score.raw, max: score.max } });
      out.textContent = `${score.raw} of ${score.max} correct (${(score.scaled * 100).toFixed(0)}%) — ${score.passed ? 'passed' : 'below the pass mark; review the reading and try again'}.`;
      form.querySelectorAll('fieldset').forEach((fs, i) => fs.classList.add(score.results[i].correct ? 'is-correct' : 'is-wrong'));
      renderAll();
    });
    view.append(form);
  } else {
    const rec = state.progress.items[it.id];
    view.append(el('p', { class: 'meta', text: `${it.points} points · due ${new Date(it.dueAt).toUTCString().slice(0, 16)}${rec?.submittedAt ? ` · submitted ${rec.submittedAt.slice(0, 10)} (${rec.words} words)` : ''}` }), el('p', { text: it.brief }));
    const ta = el('textarea', { id: 'assignment-text', rows: '10', 'aria-label': 'Your response' });
    ta.value = rec?.text ?? '';
    const count = el('p', { class: 'meta', text: `${rec?.words ?? 0} words` });
    ta.addEventListener('input', () => { count.textContent = `${ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0} words`; });
    const submit = el('button', { type: 'button', class: 'btn btn--primary', text: rec?.submittedAt ? 'Resubmit' : 'Submit' });
    submit.addEventListener('click', () => {
      if (!ta.value.trim()) { count.textContent = 'Nothing to submit.'; return; }
      state.progress = recordSubmission(state.progress, it.id, ta.value, now());
      log('completed', it, TYPES.lesson, { completion: true, response: `${state.progress.items[it.id].words} words` });
      renderAll();
      openItem(it, m);
    });
    view.append(ta, count, submit);
  }
  renderOutline();
  view.focus();
}

function gradeEntries() {
  const entries = [];
  for (const m of state.course.modules) for (const it of m.items) {
    const rec = state.progress.items[it.id];
    if (it.type === 'quiz') entries.push({ id: it.id, category: 'quizzes', earned: rec?.bestScaled === undefined ? null : rec.bestScaled * it.items.length, points: it.items.length, title: it.title });
    if (it.type === 'assignment') entries.push({ id: it.id, category: 'assignments', earned: rec?.submittedAt ? rec.score ?? null : null, points: it.points, submittedAt: rec?.submittedAt, dueAt: it.dueAt, title: it.title, ungraded: Boolean(rec?.submittedAt) && rec.score === undefined });
  }
  return entries;
}

function renderGrades() {
  const entries = gradeEntries();
  // Running grade: only attempted quizzes and graded assignments count; unattempted work is "remaining" for the target calculation.
  const scored = entries.filter((e) => !e.ungraded && e.earned !== null);
  const g = computeGrade(scored, state.course.gradeScheme);
  setText('grade-pct', g.pct === null ? '—' : `${g.pct.toFixed(1)}%`);
  setText('grade-letter', g.letter ?? '—');
  setText('grade-note', `${g.renormalised ? 'Weights renormalised over categories with scores. ' : ''}Quizzes count the best attempt, lowest dropped; assignments are ${entries.some((e) => e.ungraded) ? 'awaiting instructor marks and excluded until graded' : 'graded'}; ${(state.course.gradeScheme.latePenaltyPerDay * 100).toFixed(0)}% per day late, zero after ${state.course.gradeScheme.maxLateDays} days.`);
  const tb = $('grade-tbody');
  tb.replaceChildren();
  const rowsById = new Map(g.categories.flatMap((c) => c.rows.map((r) => [r.id, { ...r, category: c.label }])));
  for (const e of entries) {
    const r = rowsById.get(e.id);
    const tr = el('tr');
    tr.append(el('td', { text: e.title }), el('td', { text: state.course.gradeScheme.categories.find((c) => c.id === e.category).label }), el('td', { text: e.ungraded ? 'submitted, awaiting mark' : r ? `${r.earned}/${r.points}` : 'not yet' }), el('td', { text: r?.late ? `${r.late} day(s)` : '' }), el('td', { text: r ? `${(r.fraction * 100).toFixed(0)}%` : '—' }));
    tb.append(tr);
  }
  const target = Number($('target').value);
  const need = neededForTarget(entries.filter((e) => !e.ungraded), state.course.gradeScheme, target);
  setText('need-text', need.remainingWeight === 0 ? (need.achievable ? `Target ${target}% reached.` : `Target ${target}% is no longer reachable.`) : need.achievable ? `To finish at ${target}% you need an average of ${need.needed.toFixed(0)}% on the remaining ${(need.remainingWeight * 100).toFixed(0)}% of the grade.` : `${target}% is not reachable: it would need more than 100% on the remaining ${(need.remainingWeight * 100).toFixed(0)}%.`);
}

function renderActivity() {
  const weeks = state.course.weeks;
  const wa = weeklyActivity(state.statements.map((s) => s.timestamp), weeks);
  charts.bars($('activityChart'), wa.map((w) => w.week), wa.map((w) => w.activeDays), 'Active days (your statements)');
  setText('statements-text', `${state.statements.length} xAPI statements stored in this browser as ${state.actor.name}. Verbs: ${[...new Set(state.statements.map((s) => s.verb.display['en-US']))].join(', ') || 'none yet'}.`);
}

function renderCohort() {
  const items = state.course.modules.flatMap((m) => m.items).filter((i) => i.type !== 'assignment');
  const ctx = { totalItems: items.length, weeks: state.course.weeks, asOf: state.cohort.asOf };
  const evals = state.cohort.learners.map((l) => evaluateLearner(l, ctx));
  const s = cohortSummary(evals);
  setText('c-n', s.n);
  setText('c-t2', s.tiers[2]);
  setText('c-t3', s.tiers[3]);
  setText('c-t4', s.tiers[4]);
  setText('c-sessions', s.meanSessionsPerWeek.toFixed(1));
  setText('c-access', fmtPct(s.meanContentAccessPct));
  setText('c-ontime', fmtPct(s.meanOnTimePct));
  setText('c-grade', fmtPct(s.meanGradePct));
  const w = weeklyActiveShare(state.cohort.learners, state.course.weeks);
  charts.line($('cohortChart'), w.map((x) => x.week), [{ label: 'Learners active', data: w.map((x) => x.active) }], `Week (as of ${state.cohort.asOf.slice(0, 10)})`, 'Learners');
  const ia = itemAccess(state.cohort.learners, items.map((i) => i.id));
  charts.bars($('accessChart'), ia.map((x) => items.find((i) => i.id === x.id).title), ia.map((x) => x.learners), 'Learners who opened the item');
  charts.donut($('tierChart'), [1, 2, 3, 4].map((t) => `Tier ${t} ${TIER_LABELS[t].split(' (')[0]}`), [1, 2, 3, 4].map((t) => s.tiers[t]), ['#3fb950', '#d29922', '#f85149', '#8b98b0']);
  const tb = $('cohort-tbody');
  tb.replaceChildren();
  for (const e of [...evals].sort((a, b) => b.tier - a.tier || (a.gradePct ?? 0) - (b.gradePct ?? 0))) {
    const tr = el('tr', { class: `tier-${e.tier}` });
    tr.append(el('td', { text: e.name }), el('td', { text: `${e.tier} · ${TIER_LABELS[e.tier].split(' (')[0]}` }), el('td', { text: e.sessionsPerWeek.toFixed(1) }), el('td', { text: `${e.contentAccessPct.toFixed(0)}%` }), el('td', { text: e.onTimePct === null ? '—' : `${e.onTimePct.toFixed(0)}%` }), el('td', { text: e.gradePct === null ? '—' : `${e.gradePct.toFixed(0)}%` }), el('td', { text: Number.isFinite(e.inactiveDays) ? e.inactiveDays : '—' }), el('td', { text: [...e.engagementFlags, ...e.performanceFlags].join('; ') || '—' }));
    tb.append(tr);
  }
  state.evals = evals;
  setText('cohort-note', `Synthetic cohort (seed ${state.cohort.seed}, generated ${state.cohort.generated}); no real students. Rules: logins < ${THRESHOLDS.loginsPerWeek}/week, content access < ${THRESHOLDS.contentAccessPct}%, on-time < ${THRESHOLDS.onTimeSubmissionPct}%, running grade < ${THRESHOLDS.gradePct}%, ${THRESHOLDS.decliningRun}+ declining scores, any failed assessment; Tier 2 = 2+ flags in a group, Tier 3 = 3 performance flags, Tier 4 = ${THRESHOLDS.inactiveDays}+ days inactive. No predictive risk score is computed — the framework's probability model needs training data this prototype does not have.`);
}

function renderAll() {
  renderOutline();
  renderGrades();
  renderActivity();
  save();
  shell?.refreshKpis();
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function setRole(role) {
  state.role = role;
  $('learner-view').hidden = role !== 'learner';
  $('instructor-view').hidden = role !== 'instructor';
  for (const b of document.querySelectorAll('[data-role]')) b.setAttribute('aria-pressed', b.dataset.role === role ? 'true' : 'false');
  if (role === 'instructor') renderCohort();
}

async function boot() {
  const Chart = await loadChartLib();
  charts = makeCharts(Chart);
  if (!Chart) $('chart-notice').hidden = false;
  [state.course, state.cohort] = await Promise.all([fetch('data/course.json').then((r) => r.json()), fetch('data/cohort.json').then((r) => r.json())]);
  const problems = validateCourse(state.course);
  if (problems.length) { setText('course-problems', problems.join(' · ')); return; }
  load();
  setText('course-title', state.course.title);
  setText('course-desc', state.course.description);
  for (const b of document.querySelectorAll('[data-role]')) b.addEventListener('click', () => setRole(b.dataset.role));
  $('target').addEventListener('change', renderGrades);
  $('export-xapi').addEventListener('click', () => download('statements.json', JSON.stringify(state.statements, null, 2), 'application/json'));
  $('reset').addEventListener('click', () => { state.progress = { items: {} }; state.statements = []; state.current = null; $('item-view').replaceChildren(el('p', { class: 'meta', text: 'Progress cleared. Pick an item from the outline.' })); renderAll(); });
  $('export-cohort').addEventListener('click', () => download('cohort-evaluations.csv', evaluationsCsv(state.evals ?? []), 'text/csv'));
  $('grades-file').addEventListener('change', async () => {
    const f = $('grades-file').files[0];
    if (!f) return;
    try {
      const { entries, warnings } = parseGradesCsv(await f.text());
      const g = computeGrade(entries, state.course.gradeScheme);
      setText('import-result', `${entries.length} entries → ${g.pct === null ? '—' : `${g.pct.toFixed(1)}% (${g.letter})`}; ${g.categories.map((c) => `${c.label} ${c.pct === null ? '—' : `${c.pct.toFixed(1)}%`}${c.dropped ? ` (dropped ${c.dropped})` : ''}`).join(', ')}${warnings.length ? ` · warnings: ${warnings.join('; ')}` : ''}`);
    } catch (err) { setText('import-result', `Import failed: ${err.message}`); }
  });
  const next = nextItem(state.course, state.progress);
  renderAll();
  if (next) openItem(next, state.course.modules.find((x) => x.id === next.moduleId));
  setRole('learner');

  shell = mountExecShell({
    title: 'Educational LMS Prototype',
    tagline: 'A working learning-management core in the browser: a five-module course with prerequisites and a completion engine, quizzes with pass marks, assignments with due dates, a weighted gradebook with drop-lowest and late rules, xAPI 1.0.3 statements you can export, and rule-based cohort analytics that implement the shipped research framework.',
    repo: 'https://github.com/Freddricklogan/Educational-LMS-Prototype',
    pagesUrl: 'https://freddricklogan.github.io/Educational-LMS-Prototype/',
    badges: [{ label: 'xAPI 1.0.3', tone: 'accent' }, { label: 'Progress stays in your browser', dot: true }, { label: 'Synthetic cohort', dot: true }],
    kpis: [
      { label: 'Course progress', compute: () => `${courseProgress(state.course, state.progress).pct.toFixed(0)}%`, tone: 'accent' },
      { label: 'Running grade', compute: () => $('grade-pct').textContent, tone: 'ok' },
      { label: 'xAPI statements', compute: () => state.statements.length },
      { label: 'Cohort (synthetic)', compute: () => state.cohort.learners.length, tone: 'muted' },
      { label: 'Tier 3–4 learners', compute: () => { const items = state.course.modules.flatMap((m) => m.items).filter((i) => i.type !== 'assignment'); return state.cohort.learners.map((l) => evaluateLearner(l, { totalItems: items.length, weeks: state.course.weeks, asOf: state.cohort.asOf })).filter((e) => e.tier >= 3).length; }, tone: 'warn' }
    ],
    tour: [
      { selector: '#outline', title: 'Prerequisites that actually lock', body: 'Module 2 opens only when Module 1 is complete: the reading opened and the quiz passed at 75 %. The engine is a pure function over a progress record, tested end to end.' },
      { selector: '#item-view', title: 'Quizzes with a key, not a button', body: 'Answers are scored against the course file; the best attempt counts, and each answer becomes an xAPI "answered" statement with the ADL verb IRI.', action: () => { const q = state.course.modules[0].items[1]; openItem(q, state.course.modules[0]); } },
      { selector: '#grades-panel', title: 'A gradebook with rules you can read', body: 'Weighted categories, lowest quiz dropped, 10 % a day late, zero after five days, and the average you need on what remains to hit your target.', action: () => { $('target').value = '90'; renderGrades(); } },
      { selector: '#instructor-view', title: 'Analytics that cite their thresholds', body: 'The instructor view applies the thresholds from the shipped learning-analytics framework to a synthetic cohort — logins, content access, on-time rate, running grade, declining runs, inactivity — and assigns intervention tiers. No risk score is invented.', action: () => setRole('instructor') }
    ]
  });
  shell.refreshKpis();
}

boot();
