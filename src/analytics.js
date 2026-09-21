/**
 * Rule-based learning analytics implementing the thresholds in research/learning-analytics-framework.md
 * (§2.1 activity metrics, §2.2 performance metrics, §4 intervention tiers). No predictive model is fitted;
 * the framework's "risk score" is not computed here and the page says so.
 */

export const THRESHOLDS = { loginsPerWeek: 3, contentAccessPct: 60, onTimeSubmissionPct: 80, gradePct: 70, decliningRun: 2, inactiveDays: 14 };

const dayKey = (iso) => iso.slice(0, 10);

/** Distinct active days per ISO week from a list of ISO timestamps. */
export function weeklyActivity(timestamps, weeks) {
  const days = new Set(timestamps.map(dayKey));
  return weeks.map((w) => {
    const start = Date.parse(w.start);
    const end = start + 7 * 86400000;
    let active = 0;
    for (const d of days) {
      const t = Date.parse(d);
      if (t >= start && t < end) active += 1;
    }
    return { week: w.label, activeDays: active };
  });
}

/**
 * Evaluates one learner. `learner` = { id, name, sessions: [iso...], accessed: [itemId...], submissions: [{ id, submittedAt, dueAt, score, max }],
 * quizzes: [{ id, scaled, passed, at }] }. `course` = { totalItems, assignments: n, weeks: [{label,start}], asOf }.
 */
export function evaluateLearner(learner, course) {
  const weeksElapsed = Math.max(1, course.weeks.filter((w) => Date.parse(w.start) <= Date.parse(course.asOf)).length);
  const sessionsPerWeek = learner.sessions.length / weeksElapsed;
  const contentAccessPct = course.totalItems ? (new Set(learner.accessed).size / course.totalItems) * 100 : 0;
  const due = learner.submissions.filter((s) => Date.parse(s.dueAt) <= Date.parse(course.asOf));
  const onTime = due.filter((s) => s.submittedAt && Date.parse(s.submittedAt) <= Date.parse(s.dueAt)).length;
  const onTimePct = due.length ? (onTime / due.length) * 100 : null;
  const scored = [...due.filter((s) => s.submittedAt), ...learner.quizzes.map((q) => ({ score: q.scaled * 100, max: 100, at: q.at, submittedAt: q.at }))]
    .filter((s) => s.score !== null && s.score !== undefined)
    .sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt))
    .map((s) => (s.score / s.max) * 100);
  const gradePct = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
  let decline = 0;
  // A strictly lower score extends the run; a higher one resets it; an equal one leaves it unchanged.
  for (let i = 1; i < scored.length; i += 1) decline = scored[i] < scored[i - 1] ? decline + 1 : scored[i] > scored[i - 1] ? 0 : decline;
  const failedAssessments = learner.quizzes.filter((q) => !q.passed).length;
  const lastActive = learner.sessions.length ? Math.max(...learner.sessions.map(Date.parse)) : null;
  const inactiveDays = lastActive === null ? Infinity : Math.max(0, Math.floor((Date.parse(course.asOf) - lastActive) / 86400000));

  const engagement = [];
  if (sessionsPerWeek < THRESHOLDS.loginsPerWeek) engagement.push(`logins ${sessionsPerWeek.toFixed(1)}/week (< ${THRESHOLDS.loginsPerWeek})`);
  if (contentAccessPct < THRESHOLDS.contentAccessPct) engagement.push(`content access ${contentAccessPct.toFixed(0)}% (< ${THRESHOLDS.contentAccessPct}%)`);
  if (onTimePct !== null && onTimePct < THRESHOLDS.onTimeSubmissionPct) engagement.push(`on-time submissions ${onTimePct.toFixed(0)}% (< ${THRESHOLDS.onTimeSubmissionPct}%)`);
  const performance = [];
  if (gradePct !== null && gradePct < THRESHOLDS.gradePct) performance.push(`running grade ${gradePct.toFixed(0)}% (< ${THRESHOLDS.gradePct}%)`);
  if (decline >= THRESHOLDS.decliningRun) performance.push(`${decline} consecutive declining scores`);
  if (failedAssessments > 0) performance.push(`${failedAssessments} assessment(s) below pass mark`);

  let tier = 1;
  if (inactiveDays >= THRESHOLDS.inactiveDays) tier = 4;
  else if (performance.length >= 3) tier = 3;
  else if (engagement.length >= 2 || performance.length >= 2) tier = 2;
  return { id: learner.id, name: learner.name, sessionsPerWeek, contentAccessPct, onTimePct, gradePct, decliningRun: decline, failedAssessments, inactiveDays, engagementFlags: engagement, performanceFlags: performance, tier };
}

export const TIER_LABELS = { 1: 'Universal', 2: 'Targeted', 3: 'Intensive', 4: 'Crisis (14+ days inactive)' };

export function cohortSummary(evaluations) {
  const tiers = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of evaluations) tiers[e.tier] += 1;
  const mean = (k) => { const v = evaluations.map((e) => e[k]).filter((x) => x !== null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  return { n: evaluations.length, tiers, meanSessionsPerWeek: mean('sessionsPerWeek'), meanContentAccessPct: mean('contentAccessPct'), meanOnTimePct: mean('onTimePct'), meanGradePct: mean('gradePct') };
}

/** Weekly active learners: share of the cohort with at least one session in each week. */
export function weeklyActiveShare(learners, weeks) {
  return weeks.map((w) => {
    const start = Date.parse(w.start);
    const end = start + 7 * 86400000;
    const active = learners.filter((l) => l.sessions.some((s) => { const t = Date.parse(s); return t >= start && t < end; })).length;
    return { week: w.label, active, pct: learners.length ? (active / learners.length) * 100 : 0 };
  });
}

/** Access count per content item across the cohort. */
export function itemAccess(learners, itemIds) {
  return itemIds.map((id) => ({ id, learners: learners.filter((l) => l.accessed.includes(id)).length }));
}

export function evaluationsCsv(evals) {
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const head = ['id', 'name', 'tier', 'sessions_per_week', 'content_access_pct', 'on_time_pct', 'grade_pct', 'inactive_days', 'engagement_flags', 'performance_flags'];
  const rows = evals.map((e) => [e.id, e.name, e.tier, e.sessionsPerWeek.toFixed(2), e.contentAccessPct.toFixed(1), e.onTimePct === null ? '' : e.onTimePct.toFixed(1), e.gradePct === null ? '' : e.gradePct.toFixed(1), Number.isFinite(e.inactiveDays) ? e.inactiveDays : '', e.engagementFlags.join('; '), e.performanceFlags.join('; ')].map(esc).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}
