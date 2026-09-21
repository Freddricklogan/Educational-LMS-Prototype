import { describe, expect, it } from 'vitest';
import { applyLate, computeGrade, daysLate, letterFor, neededForTarget, parseGradesCsv, validateScheme } from '../src/gradebook.js';

const scheme = { categories: [{ id: 'quizzes', label: 'Quizzes', weight: 0.4, dropLowest: 1 }, { id: 'assignments', label: 'Assignments', weight: 0.6 }], latePenaltyPerDay: 0.1, maxLateDays: 5 };

describe('validateScheme', () => {
  it('checks weights, ids and rules', () => {
    expect(validateScheme(scheme)).toEqual([]);
    expect(validateScheme({ categories: [] })).toEqual(['scheme needs categories']);
    expect(validateScheme({ categories: [{ id: 'a', label: 'A', weight: 0.7 }, { label: 'B', weight: 0.5, dropLowest: -1 }], latePenaltyPerDay: 2 })).toEqual(expect.arrayContaining(['category weights sum to 1.200, not 1', 'every category needs id and label', 'category "undefined": dropLowest must be a non-negative integer', 'latePenaltyPerDay must be 0–1']));
  });
});

describe('late rules', () => {
  it('rounds days late up and applies the per-day penalty with a hard cap', () => {
    expect(daysLate('2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')).toBe(0);
    expect(daysLate('2026-09-01T00:00:01Z', '2026-09-01T00:00:00Z')).toBe(1);
    expect(daysLate('2026-09-03T12:00:00Z', '2026-09-01T00:00:00Z')).toBe(3);
    expect(daysLate(undefined, '2026-09-01T00:00:00Z')).toBe(0);
    expect(applyLate(0.9, 0, scheme)).toBe(0.9);
    expect(applyLate(0.9, 2, scheme)).toBeCloseTo(0.7, 9);
    expect(applyLate(0.15, 2, scheme)).toBe(0);
    expect(applyLate(1, 6, scheme)).toBe(0);
    expect(applyLate(1, 6, { latePenaltyPerDay: 0.1 })).toBeCloseTo(0.4, 9);
  });
});

describe('computeGrade', () => {
  const entries = [
    { id: 'q1', category: 'quizzes', earned: 4, points: 4 },
    { id: 'q2', category: 'quizzes', earned: 2, points: 4 },
    { id: 'q3', category: 'quizzes', earned: 3, points: 4 },
    { id: 'a1', category: 'assignments', earned: 18, points: 20, submittedAt: '2026-08-30T23:00:00Z', dueAt: '2026-08-30T23:59:00Z' },
    { id: 'a2', category: 'assignments', earned: 24, points: 30, submittedAt: '2026-09-22T10:00:00Z', dueAt: '2026-09-20T23:59:00Z' }
  ];
  it('drops the lowest quiz, penalises the late assignment, and weights categories', () => {
    const g = computeGrade(entries, scheme);
    const quizzes = g.categories[0];
    expect(quizzes.dropped).toBe(1);
    expect(quizzes.pct).toBeCloseTo((7 / 8) * 100, 6); // q1 and q3 kept
    const assignments = g.categories[1];
    // a2: 24/30 = 0.8, 2 days late → 0.6 → 18 of 30 points; a1 18/20 → 36 of 50 total
    expect(assignments.pct).toBeCloseTo((36 / 50) * 100, 6);
    expect(g.pct).toBeCloseTo(0.4 * 87.5 + 0.6 * 72, 6);
    expect(g.letter).toBe('C');
    expect(g.renormalised).toBe(false);
  });
  it('treats missing as zero, honours excused, and renormalises when a category has no scores', () => {
    const g = computeGrade([{ id: 'q1', category: 'quizzes', earned: null, points: 4 }, { id: 'q2', category: 'quizzes', earned: 4, points: 4 }], { ...scheme, categories: [{ ...scheme.categories[0], dropLowest: 0 }, scheme.categories[1]] });
    expect(g.categories[0].pct).toBe(50);
    expect(g.categories[1].pct).toBeNull();
    expect(g.pct).toBe(50);
    expect(g.renormalised).toBe(true);
    const ex = computeGrade([{ id: 'q1', category: 'quizzes', earned: null, points: 4, excused: true }, { id: 'q2', category: 'quizzes', earned: 4, points: 4 }], scheme);
    expect(ex.categories[0].pct).toBe(100);
    expect(computeGrade([], scheme).pct).toBeNull();
    expect(computeGrade([], scheme).letter).toBeNull();
  });
  it('dropLowest never drops the only entry', () => {
    const g = computeGrade([{ id: 'q1', category: 'quizzes', earned: 1, points: 4 }], scheme);
    expect(g.categories[0].dropped).toBe(0);
    expect(g.categories[0].pct).toBe(25);
  });
  it('letters follow the scale', () => {
    expect(letterFor(95)).toBe('A');
    expect(letterFor(90)).toBe('A');
    expect(letterFor(89.9)).toBe('B');
    expect(letterFor(10)).toBe('F');
    expect(letterFor(50, [['Pass', 50], ['Fail', 0]])).toBe('Pass');
  });
  it('computes what is needed on remaining points to reach a target', () => {
    const partial = [{ id: 'q1', category: 'quizzes', earned: 4, points: 4 }, { id: 'q2', category: 'quizzes', earned: null, points: 4 }, { id: 'a1', category: 'assignments', earned: 15, points: 20 }, { id: 'a2', category: 'assignments', earned: null, points: 30 }];
    const need = neededForTarget(partial, scheme, 80);
    // have = 0.4*(4/8)*100 + 0.6*(15/50)*100 = 20 + 18 = 38; remaining weight = 0.4*0.5 + 0.6*0.6 = 0.56 → need (80-38)/0.56 = 75
    expect(need.remainingWeight).toBeCloseTo(0.56, 9);
    expect(need.needed).toBeCloseTo(75, 6);
    expect(need.achievable).toBe(true);
    expect(neededForTarget(partial, scheme, 99).achievable).toBe(false);
    const done = neededForTarget([{ id: 'q1', category: 'quizzes', earned: 4, points: 4 }, { id: 'a1', category: 'assignments', earned: 20, points: 20 }], scheme, 90);
    expect(done).toMatchObject({ achievable: true, needed: null, remainingWeight: 0 });
  });
});

describe('parseGradesCsv', () => {
  it('parses, warns and rejects', () => {
    const { entries, warnings } = parseGradesCsv('id,category,earned,points,submittedAt,dueAt\nq1,quizzes,3,4,,\nq2,quizzes,,4,,\nbad,quizzes,9,4,,\n,quizzes,1,4,,\nz,assignments,1,0,,');
    expect(entries).toHaveLength(2);
    expect(entries[1].earned).toBeNull();
    expect(warnings).toEqual(['row 4: earned must be between 0 and points', 'row 5: missing id', 'row 6: points must be positive']);
    expect(() => parseGradesCsv('id,earned\n')).toThrow(/missing column: category/);
    expect(() => parseGradesCsv('')).toThrow(/empty/);
  });
});
