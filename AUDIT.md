# AUDIT — Educational LMS Prototype (pre-refactor)

Audit of the previous build: one 738-line `index.html` (markup, CSS and
a 146-line inline script drawing two charts from typed arrays) plus two
research documents. The page was a student dashboard for a fictional
"Alex Johnson" with nothing behind it: no course, no quiz, no grade
computation, no event log. Line numbers refer to the old file.

---

## A. Honesty of the copy

### A1 — "Learning Management System" that managed nothing
Nine sidebar links (`href="#"`, lines 315–325) to Courses, Grades,
Analytics, Calendar, Messages, Library, Settings and Help; four course
cards with progress bars set by `style="width: 78%"`; a GPA of 3.56
and a 73 % completion rate typed into the markup (lines 349–372).
**Fix:** a course engine (`src/course.js`) with a five-module course in
`data/course.json`: prerequisites that lock, readings, quizzes scored
against a key with pass marks, and assignments with due dates. Progress
is a record the engine computes from, persisted in the browser.

### A2 — "Weekly Engagement" and "Grade Distribution" from typed arrays
Lines 600–650: `[12, 15, 14, 18, …]` hours and `[8, 10, 9, …]`
activities for a learner who did not exist. **Fix:** the learner's
activity chart is built from their own xAPI statements; the instructor
view is built from a seeded synthetic cohort labelled as such on the
page, with the seed and generation date printed.

### A3 — Analytics with no relation to the shipped framework
`research/learning-analytics-framework.md` sets thresholds (logins
under 3 per week, content access under 60 %, on-time submissions under
80 %, running grade under 70 %, two consecutive declining grades,
14 days of inactivity) and four intervention tiers. The page used none
of them. **Fix:** `src/analytics.js` implements exactly those rules and
tiers, cites them on the page, and states that the framework's
predictive risk score is *not* computed because there is no training
data.

## B. Correctness

### B1 — No grade computation
A GPA appeared; nothing computed it. **Fix:** `src/gradebook.js`:
weighted categories validated to sum to 1, drop-lowest that never drops
the only entry, per-day late penalty with a hard cap, letter scale,
renormalisation when a category has no scores yet, and the average
needed on remaining work to reach a target — each tested against hand
arithmetic.

### B2 — No completion semantics
"78 % progress" was a width. **Fix:** an item is complete when a
reading is opened, a quiz is passed at its pass mark (best attempt
counts, later lower attempts never reduce it), or an assignment is
submitted; a module is complete when all its items are; a module
unlocks when the module it requires is complete. The next-item function
follows that order and returns null when the course is done.

### B3 — No interoperability
Nothing left the page. **Fix:** every launch, read, attempt, answer,
pass, fail and submission becomes an xAPI 1.0.3 statement with ADL verb
and activity-type IRIs, validated by the shape an LRS checks first, and
exportable as a JSON array; the instructor view exports evaluations as
CSV and imports a grades CSV with per-row validation.

## C. Security and structure

### C1 — No CSP; 11 `style=` attributes; unpinned Chart.js without SRI
Line 7 loaded `chart.js` with no version. **Fix:** `default-src 'none'`
policy, classes, Chart.js 3.9.1 with an SRI hash and a vendored
fallback, all DOM writes via `textContent`; assignment text and pasted
CSV are untrusted and never reach `innerHTML`.

### C2 — Unsplash stock image in structured data
Line 305. **Fix:** removed.

## D. Engineering

### D1 — No tests, no CI, no data files
**Fix:** four pure modules with 23 Vitest tests (98.76 % statements),
including failure paths for broken course files, bad grade schemes and
CSV rows, unknown xAPI verbs, and every analytics threshold; ESLint and
html-validate in the lint job, security scan, Pages deployment.

### D2 — Accessibility
The old outline used generic `div`s. **Fix:** module items are real
buttons with `aria-pressed`, locked items are disabled rather than
hidden, quiz choices are radio inputs in labelled fieldsets, results
are announced through `aria-live`, and the item view receives focus
when it changes.
