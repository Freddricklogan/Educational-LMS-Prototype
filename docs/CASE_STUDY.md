# Case Study — Educational LMS Prototype

**Repository:** [Educational-LMS-Prototype](https://github.com/Freddricklogan/Educational-LMS-Prototype) · **Live demo:** [freddricklogan.github.io/Educational-LMS-Prototype](https://freddricklogan.github.io/Educational-LMS-Prototype/) · **Author:** Freddrick Logan

---

## 1. Who has this problem

Instructional designers and educational technologists who need to show, not describe, how a course should behave before a platform is chosen; faculty who want to understand what a gradebook rule or an intervention threshold actually does to a student; and learning-analytics teams who have a framework document and no reference implementation of it. The gap between the document and the running thing is where most misunderstandings live.

## 2. The problem, as a scenario

A committee is evaluating learning platforms. The prototype on the table has a sidebar, a student named Alex, a GPA of 3.56 and four progress bars. A member asks what happens when a student fails a quiz, whether a late assignment loses marks, and how the "at-risk" label is decided. Nothing behind it computes anything. The earlier version of this repository was that prototype — typed numbers, CSS-width progress, charts from arrays — beside a learning-analytics framework it never used.

## 3. What it costs to leave it alone

Decisions about platforms and policies get made on impressions. A gradebook rule agreed in a meeting turns out, in the live system, to zero a whole category when one item is missing; a threshold in a framework document is never tested against a cohort until real students are flagged by it. For students in educational technology programmes, a prototype that does nothing teaches that the discipline is interface design. The cost is the habit of confusing a picture of a system with a system.

## 4. The approach, and the alternative I rejected

I rejected adding screens to the mock-up; another tab does not make a quiz score itself. Instead the page became a small but real learning-management core made of pure modules. `src/course.js` validates a course file and defines completion: a reading is complete when opened, a quiz when passed at its pass mark on the best attempt, an assignment when submitted; a module unlocks when the module it requires is complete. `src/gradebook.js` implements weighted categories, drop-lowest, capped late penalties, renormalisation, and the average needed on remaining work to reach a target. `src/xapi.js` turns every action into an xAPI 1.0.3 statement with ADL verb and activity-type IRIs. `src/analytics.js` implements the thresholds and intervention tiers from the framework document that ships in the repository — and refuses to invent the framework's predictive risk score, which would need training data the prototype does not have.

## 5. What the code does today

The learner view presents a five-module course on cloud foundations. Modules lock until the previous one is complete; readings are marked when opened; quizzes are scored against a key with a 75 % pass mark and each answer becomes an "answered" statement; assignments take a submission with a word count and a due date. The gradebook shows the running grade with its rules, each item after late rules, and the average the remaining work needs for your target. An activity chart is drawn from your own statements, which you can export as JSON or clear. Progress persists in the browser under an anonymous learner id. The instructor view applies the framework's rules to a seeded synthetic cohort of forty learners — labelled synthetic, with seed and date — with weekly active learners, content reach, tiers, a per-learner table of the flags that fired, CSV export, and a grades CSV import.

## 6. Evidence

Twenty-three Vitest tests cover course validation, the lock and unlock sequence, a failed attempt keeping a module locked, a lower later attempt not reducing the best score, a full run to completion, quiz scoring with unanswered items, every gradebook rule against hand arithmetic, CSV parsing with rejected rows, xAPI statement shape, and each analytics threshold and tier. Statement coverage is 98.76 %. In headless Chrome, ten of twelve items are locked at start; a 50 % quiz fails and keeps Module 2 locked; 100 % passes and unlocks it; thirteen statements exist after one module with the verbs experienced, attempted, answered, failed and passed; progress and statements survive a reload; the synthetic cohort evaluates to tiers of 26, 10, 1 and 3; there were zero console errors and no horizontal scroll at 1280 or 400 pixels. `AUDIT.md` records ten findings against the earlier build.

## 7. What it would take to run this in production

The modules are the reusable part. Persist progress and statements to a server — an LRS for the xAPI stream, a database for progress — behind authentication, and move grading of assignments to an instructor workflow with rubrics. Fit the framework's risk model on historical cohorts with outcomes, with the transparency and student-rights provisions the framework itself requires, before any predictive score is shown to anyone.

## 8. Limits and next steps

One course, one learner per browser, no authentication, no instructor marking of assignments, and a synthetic cohort. Quizzes are single-answer multiple choice. The analytics are rule-based by design; they flag, they do not predict. Next, in order: rubric-based assignment marking in the instructor view, QTI import for question banks, and a Common Cartridge exporter so the course file becomes portable.

## 9. Who should look at this

**Hiring manager:** evidence that I build learning systems whose rules are explicit, tested and standards-based, and that I implement a framework rather than decorate it.
**Consulting client:** a reference implementation for gradebook and intervention policies you can run against your own thresholds before configuring a platform.
**Engineer:** read `src/course.js` and `src/gradebook.js` with their tests for the semantics, and `src/analytics.js` beside `research/learning-analytics-framework.md` for the rule mapping.
