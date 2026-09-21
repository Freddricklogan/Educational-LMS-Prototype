/**
 * Generates data/cohort.json: a seeded, synthetic cohort of 40 learners in the shipped course, with sessions,
 * content accesses, submissions and quiz results through the "as of" date. No real students. Run: node scripts/generate-cohort.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { mulberry32 } from './rng.js';

const course = JSON.parse(readFileSync(new URL('../data/course.json', import.meta.url), 'utf8'));
const AS_OF = '2026-09-20T12:00:00Z';
const u = mulberry32(430);
const items = course.modules.flatMap((m) => m.items);
const readings = items.filter((i) => i.type === 'reading').map((i) => i.id);
const quizzes = items.filter((i) => i.type === 'quiz');
const assignments = items.filter((i) => i.type === 'assignment');
const FIRST = ['Amara', 'Ben', 'Chloe', 'Dev', 'Elena', 'Farid', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kira', 'Luis', 'Maya', 'Nia', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Victor', 'Wen', 'Xavier', 'Yara', 'Zane', 'Ava', 'Bao', 'Cara', 'Dana', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kai', 'Lena', 'Milo', 'Nora'];
const start = Date.parse(course.weeks[0].start);
const weeksElapsed = course.weeks.filter((w) => Date.parse(w.start) <= Date.parse(AS_OF)).length;
const iso = (t) => new Date(t).toISOString();
const gauss = () => { const a = u() || 1e-12; return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };

const learners = FIRST.map((name, i) => {
  // Engagement profile: most steady, some fading, a few disengaged.
  const profile = i % 10 === 7 ? 'fading' : i % 13 === 5 ? 'gone' : i % 8 === 3 ? 'light' : 'steady';
  const base = profile === 'steady' ? 4.2 : profile === 'light' ? 2.2 : profile === 'fading' ? 4 : 3;
  const ability = Math.min(0.98, Math.max(0.35, 0.78 + 0.12 * gauss()));
  const sessions = [];
  for (let w = 0; w < weeksElapsed; w += 1) {
    let rate = base;
    if (profile === 'fading') rate = Math.max(0.3, base - w * 0.8);
    if (profile === 'gone' && w >= 3) rate = 0;
    const n = Math.max(0, Math.round(rate + 0.9 * gauss()));
    const days = new Set();
    while (days.size < Math.min(n, 7)) days.add(Math.floor(u() * 7));
    for (const d of days) { const t = start + w * 7 * 86400000 + d * 86400000 + Math.floor(8 + u() * 14) * 3600000; if (t <= Date.parse(AS_OF)) sessions.push(iso(t)); }
  }
  sessions.sort();
  const lastSession = sessions.length ? Date.parse(sessions[sessions.length - 1]) : start;
  const reach = profile === 'gone' ? 3 : profile === 'light' ? 6 : profile === 'fading' ? 7 : Math.min(readings.length + quizzes.length, 8 + Math.floor(u() * 3));
  const accessed = [];
  let k = 0;
  for (const m of course.modules) for (const it of m.items) { if (k < reach && it.type !== 'assignment') accessed.push(it.id); k += it.type === 'assignment' ? 0 : 1; }
  const quizResults = [];
  for (const q of quizzes) {
    if (!accessed.includes(q.id)) continue;
    const at = Math.min(lastSession, start + (quizzes.indexOf(q) + 1) * 9 * 86400000 + Math.floor(u() * 3) * 86400000);
    const drift = profile === 'fading' ? -0.06 * quizzes.indexOf(q) : 0;
    const scaled = Math.round(Math.min(1, Math.max(0, ability + drift + 0.1 * gauss())) * q.items.length) / q.items.length;
    quizResults.push({ id: q.id, scaled, passed: scaled >= (q.passMark ?? 0.7), at: iso(at) });
  }
  const submissions = assignments.map((a) => {
    const due = Date.parse(a.dueAt);
    if (due > Date.parse(AS_OF)) return { id: a.id, dueAt: a.dueAt, submittedAt: null, score: null, max: a.points };
    const skip = profile === 'gone' || (profile === 'light' && u() < 0.45) || (profile === 'fading' && a.id === 'm4-assign' && u() < 0.7) || u() < 0.06;
    if (skip) return { id: a.id, dueAt: a.dueAt, submittedAt: null, score: null, max: a.points };
    const lateDays = u() < 0.2 ? Math.ceil(u() * 3) : 0;
    const submittedAt = iso(due - Math.floor(u() * 48) * 3600000 + lateDays * 86400000);
    const score = Math.round(Math.min(1, Math.max(0.3, ability + 0.08 * gauss())) * a.points);
    return { id: a.id, dueAt: a.dueAt, submittedAt, score, max: a.points };
  });
  return { id: `L${String(i + 1).padStart(3, '0')}`, name, sessions, accessed, submissions, quizzes: quizResults };
});

writeFileSync(new URL('../data/cohort.json', import.meta.url), JSON.stringify({ synthetic: true, seed: 430, asOf: AS_OF, courseId: course.id, generated: new Date().toISOString().slice(0, 10), learners }, null, 0));
console.log(`wrote ${learners.length} learners, as of ${AS_OF}, ${weeksElapsed} weeks elapsed`);
