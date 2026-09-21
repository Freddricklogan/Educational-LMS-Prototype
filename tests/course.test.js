import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allItems, courseProgress, isItemComplete, moduleState, nextItem, recordOpened, recordQuizAttempt, recordSubmission, scoreQuiz, validateCourse } from '../src/course.js';

const course = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url), 'utf8'));
const empty = { items: {} };

describe('validateCourse', () => {
  it('accepts the shipped course (5 modules, 12 items, every quiz answer in range)', () => {
    expect(validateCourse(course)).toEqual([]);
    expect(allItems(course)).toHaveLength(12);
  });
  it('names every problem in a broken course', () => {
    const bad = { id: 'x', title: 'x', modules: [
      { id: 'a', title: 'A', items: [{ id: 'r', type: 'reading' }, { id: 'q', type: 'quiz', items: [{ id: 'q1', prompt: 'p', choices: ['a', 'b'], answer: 5 }], passMark: 2 }, { id: 'z', type: 'video' }] },
      { id: 'a', title: '', items: [], requires: 'nope' }
    ] };
    const p = validateCourse(bad);
    expect(p).toEqual(expect.arrayContaining(['module 1 item "r": reading needs a body', 'module 1 item "q": question "q1" answer index out of range', 'module 1 item "q": passMark must be 0–1', 'module 1 item "z": unknown type "video"', 'module 2: duplicate id "a"', 'module 2: needs a title', 'module 2: needs at least one item', 'module 2: requires "nope" which is not an earlier module']));
    expect(validateCourse(null)).toEqual(['course must be an object']);
    expect(validateCourse({ id: 'x', title: 'x', modules: [] })).toContain('course needs at least one module');
  });
});

describe('completion engine', () => {
  it('locks modules until the required module is complete and finds the next item in order', () => {
    expect(moduleState(course, 'm1', empty)).toMatchObject({ unlocked: true, done: 0, total: 2 });
    expect(moduleState(course, 'm2', empty).unlocked).toBe(false);
    expect(nextItem(course, empty).id).toBe('m1-read');
    let p = recordOpened(empty, 'm1-read', '2026-09-01T10:00:00Z');
    expect(nextItem(course, p).id).toBe('m1-quiz');
    p = recordQuizAttempt(p, 'm1-quiz', { scaled: 0.5 }, '2026-09-01T10:10:00Z');
    expect(isItemComplete(course.modules[0].items[1], p)).toBe(false); // below passMark 0.75
    expect(moduleState(course, 'm2', p).unlocked).toBe(false);
    p = recordQuizAttempt(p, 'm1-quiz', { scaled: 1 }, '2026-09-01T10:20:00Z');
    expect(p.items['m1-quiz']).toMatchObject({ attempts: 2, bestScaled: 1, lastScaled: 1 });
    expect(moduleState(course, 'm1', p).complete).toBe(true);
    expect(moduleState(course, 'm2', p).unlocked).toBe(true);
    expect(nextItem(course, p).id).toBe('m2-read');
    expect(courseProgress(course, p)).toMatchObject({ total: 12, done: 2, complete: false });
    expect(courseProgress(course, p).pct).toBeCloseTo(100 / 6, 6);
  });
  it('a lower later attempt does not reduce the best score; submissions count words', () => {
    let p = recordQuizAttempt(empty, 'm1-quiz', { scaled: 1 }, 't1');
    p = recordQuizAttempt(p, 'm1-quiz', { scaled: 0.25 }, 't2');
    expect(p.items['m1-quiz'].bestScaled).toBe(1);
    p = recordSubmission(p, 'm2-assign', '  one two   three ', '2026-08-29T00:00:00Z');
    expect(p.items['m2-assign']).toMatchObject({ words: 3, submittedAt: '2026-08-29T00:00:00Z' });
    expect(recordSubmission(p, 'm4-assign', '   ', 't').items['m4-assign'].words).toBe(0);
    expect(recordOpened(p, 'm1-read', 'first').items['m1-read'].openedAt).toBe('first');
    expect(recordOpened(recordOpened(p, 'm1-read', 'first'), 'm1-read', 'second').items['m1-read'].openedAt).toBe('first');
  });
  it('completes the whole course', () => {
    let p = empty;
    for (const m of course.modules) for (const it of m.items) {
      if (it.type === 'reading') p = recordOpened(p, it.id, 't');
      if (it.type === 'quiz') p = recordQuizAttempt(p, it.id, { scaled: 1 }, 't');
      if (it.type === 'assignment') p = recordSubmission(p, it.id, 'done', 't');
    }
    expect(courseProgress(course, p)).toMatchObject({ done: 12, complete: true, pct: 100 });
    expect(nextItem(course, p)).toBeNull();
  });
});

describe('scoreQuiz', () => {
  it('scores against the key, treats unanswered as wrong, applies the pass mark', () => {
    const quiz = course.modules[0].items[1];
    const key = Object.fromEntries(quiz.items.map((q) => [q.id, q.answer]));
    expect(scoreQuiz(quiz, key)).toMatchObject({ raw: 4, max: 4, scaled: 1, passed: true });
    const three = { ...key, q4: (key.q4 + 1) % 4 };
    expect(scoreQuiz(quiz, three)).toMatchObject({ raw: 3, scaled: 0.75, passed: true });
    const two = { q1: key.q1, q2: key.q2 };
    expect(scoreQuiz(quiz, two)).toMatchObject({ raw: 2, scaled: 0.5, passed: false });
    expect(scoreQuiz(quiz, two).results.find((r) => r.id === 'q3')).toMatchObject({ chosen: null, correct: false });
    expect(scoreQuiz({ items: [] }, {})).toMatchObject({ raw: 0, max: 0, scaled: 0 });
  });
});
