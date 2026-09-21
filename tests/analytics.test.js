import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cohortSummary, evaluateLearner, evaluationsCsv, itemAccess, THRESHOLDS, weeklyActiveShare, weeklyActivity } from '../src/analytics.js';

const course = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url), 'utf8'));
const cohort = JSON.parse(readFileSync(new URL('../data/cohort.json', import.meta.url), 'utf8'));
const items = course.modules.flatMap((m) => m.items).filter((i) => i.type !== 'assignment');
const ctx = { totalItems: items.length, weeks: course.weeks, asOf: cohort.asOf };
const base = { id: 'x', name: 'X', sessions: [], accessed: [], submissions: [], quizzes: [] };
const wk = (w, d = 0) => new Date(Date.parse(course.weeks[w].start) + d * 86400000 + 36e5).toISOString();

describe('evaluateLearner', () => {
  it('flags each framework threshold from the counts', () => {
    const steady = { ...base, sessions: [0, 1, 2, 3, 4, 5, 6].flatMap((w) => [wk(w, 0), wk(w, 2), wk(w, 4), wk(w, 6)]), accessed: items.map((i) => i.id), submissions: [{ id: 'm2-assign', dueAt: '2026-08-30T23:59:00Z', submittedAt: '2026-08-30T20:00:00Z', score: 18, max: 20 }], quizzes: [{ id: 'm1-quiz', scaled: 1, passed: true, at: wk(1) }] };
    const e = evaluateLearner(steady, ctx);
    expect(e).toMatchObject({ tier: 1, engagementFlags: [], performanceFlags: [], contentAccessPct: 100, onTimePct: 100 });
    expect(e.sessionsPerWeek).toBe(4);
    const light = { ...steady, sessions: [wk(0), wk(3), wk(6)], accessed: items.slice(0, 3).map((i) => i.id) };
    const l = evaluateLearner(light, ctx);
    expect(l.engagementFlags).toHaveLength(2);
    expect(l.tier).toBe(2);
    expect(l.engagementFlags[0]).toMatch(/logins 0.4\/week/);
  });
  it('detects declining runs, failed assessments and low running grade → tier 3; inactivity → tier 4', () => {
    const slipping = { ...base, sessions: [wk(6, 5)], accessed: items.map((i) => i.id), submissions: [{ id: 'm2-assign', dueAt: '2026-08-30T23:59:00Z', submittedAt: '2026-08-30T20:00:00Z', score: 10, max: 20 }], quizzes: [{ id: 'm1-quiz', scaled: 1, passed: true, at: wk(1) }, { id: 'm2-quiz', scaled: 0.75, passed: true, at: wk(2) }, { id: 'm3-quiz', scaled: 0.5, passed: false, at: wk(5) }] };
    const s = evaluateLearner(slipping, ctx);
    expect(s.decliningRun).toBe(2);
    expect(s.failedAssessments).toBe(1);
    expect(s.gradePct).toBeCloseTo((100 + 50 + 75 + 50) / 4, 6);
    expect(s.performanceFlags).toHaveLength(3);
    expect(s.tier).toBe(3);
    const gone = { ...base, sessions: [wk(0), wk(1)] };
    const g = evaluateLearner(gone, ctx);
    expect(g.inactiveDays).toBeGreaterThanOrEqual(THRESHOLDS.inactiveDays);
    expect(g.tier).toBe(4);
    expect(evaluateLearner(base, ctx)).toMatchObject({ tier: 4, inactiveDays: Infinity, gradePct: null, onTimePct: null });
  });
  it('ignores assignments not yet due when computing on-time rate', () => {
    const l = { ...base, sessions: [wk(6)], submissions: [{ id: 'future', dueAt: '2026-12-01T00:00:00Z', submittedAt: null, score: null, max: 10 }] };
    expect(evaluateLearner(l, ctx).onTimePct).toBeNull();
  });
});

describe('cohort', () => {
  const evals = cohort.learners.map((l) => evaluateLearner(l, ctx));
  it('summarises the synthetic cohort and marks it synthetic', () => {
    expect(cohort.synthetic).toBe(true);
    const s = cohortSummary(evals);
    expect(s.n).toBe(40);
    expect(s.tiers[1] + s.tiers[2] + s.tiers[3] + s.tiers[4]).toBe(40);
    expect(s.tiers[4]).toBeGreaterThan(0);
    expect(s.meanContentAccessPct).toBeGreaterThan(50);
    for (const e of evals) expect(e.inactiveDays).toBeGreaterThanOrEqual(0);
  });
  it('weekly activity and access counts are bounded by the cohort', () => {
    const w = weeklyActiveShare(cohort.learners, course.weeks);
    expect(w).toHaveLength(10);
    expect(w[0].active).toBeGreaterThan(30);
    expect(w[9].active).toBe(0); // future week
    const ia = itemAccess(cohort.learners, items.map((i) => i.id));
    expect(ia[0].learners).toBe(40);
    expect(ia.every((x) => x.learners <= 40)).toBe(true);
    const own = weeklyActivity(cohort.learners[0].sessions, course.weeks);
    expect(own.every((x) => x.activeDays <= 7)).toBe(true);
    const csv = evaluationsCsv(evals);
    expect(csv.split('\n')).toHaveLength(42);
    expect(csv).toMatch(/^id,name,tier/);
  });
});
