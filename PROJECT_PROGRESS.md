# Project Progress — Medickids

## Current Version
- **App Version:** 1.0.0-beta.49
- **Cache Version:** madhom-v77
- **Branch:** main
- **Last Commit:** 549c91526423 (js/app.js), 0987546eb966 (js/db.js), 3bf4931cedc5 (sw.js)

---

# Current Status

## Current Phase
Phase: Active Treatments

## Current Step
Step 3B — Auto-remove completed courses + manual delete + history entries

**Status:** ✅ Completed — Waiting Approval

---

# Completed Steps

### Developer Center (pre-phase)
- Timeline, Logs, Errors, Network, Database, Storage, Health, Tools, Export
- Search, Filters, Replay, Event IDs, Session IDs, Snapshot, Share, Copy, Ring Buffer, rAF coalescing
- **Status:** Frozen — no new features until Active Treatments is complete
- **Version at freeze:** beta.28 / madhom-v46

---

### Step 1A — Database Foundation ✅
- **Files:** `js/db.js`
- **What:** `migrateRx()`, `isCourse`, `totalDays`, `dosesPerDay`, `doseLog`, `logCourseDose()`, `courseProgress()`
- **Regression:** passed

### Step 1B — COURSE Helpers ✅
- **Files:** `js/app.js`
- **What:** `_activeCourses()`, `_courseNextDoseAt()`, `_courseIsDoseOverdue()`
- **Regression:** passed

### Step 1C — Cleanup ✅
- **Files:** `js/app.js`
- **What:** removed duplicate blocks, added `_courseSummary()`
- **Regression:** passed

### Step 1D — ViewModel ✅
- **Files:** `js/app.js`
- **What:** `_activeTreatmentState(childId)` → returns `hasActiveCourse`, `activeCourses`, `overdueCount`, `nextDoseAt`, `nextCourse`, `summary`
- No DB access, no render, no notifications — pure ViewModel
- **Regression:** passed

### Step 1E — Dashboard Card (Read Only) ✅
- **Files:** `js/app.js`, `index.html`
- **What:** `dash-active-treatments` container + `_renderActiveTreatmentsCard(children)`
- Read-only: no buttons, no progress, no bottom sheet
- **Regression:** passed

### Step 2A — COURSE Catalog + sheet-course ✅
- **Files:** `js/app.js`, `index.html`, `sw.js`
- **What:**
  - 3 COURSE drugs added to `MEDICATION_CATALOG`: מוקסיפן (`moxipen_susp`), אמוקסיצילין (`amoxicillin_generic`), אוגמנטין (`augmentin_susp`)
  - New Bottom Sheet: `sheet-course` (child chips, drug chips, days input, doses/day input, CTA)
  - Functions: `openCourseSheet()`, `pickCourseChild()`, `pickCourseDrug()`, `saveCourse()`
  - Saves via `DB.addPrescription()` with `isCourse: true`
- **Version:** beta.29 / madhom-v47
- **Regression:** passed

### Step 2A Entry Point ✅
- **Files:** `index.html`, `js/app.js`, `sw.js`
- **What:** Added `🗓️ התחל טיפול` button to `qa-grid` in dashboard → `App.openCourseSheet()`
- **Version:** beta.30 / madhom-v48
- **Regression:** passed

### Step 3A — Mark Dose ✅
- **Files:** `js/app.js`
- **What:**
  - `markCourseDose(rxId)` with 3 guards: rx not found, already completed, total doses exceeded
  - `_dosesTodayCount(rx)` — counts doses logged since 00:00 today
  - `canMark = dosesDone < totalDoses && dosesToday < dosesPerDay`
  - Daily limit guard in both card render and `markCourseDose`
  - Toast: `✓ מנה N מתוך X סומנה` / `🎉 הטיפול הושלם בהצלחה!`
- **Version:** beta.31 → beta.32 / madhom-v49 → madhom-v50
- **Regression:** passed

### Step 3B — Auto-remove completed + manual delete + history ✅
- **Files:** `js/app.js`, `js/db.js`, `sw.js`
- **What:**
  - `_renderActiveTreatmentsCard` — shows only `status === 'active'` courses; completed auto-hidden
  - Label changed: "תקין" → "🟢 פעיל"
  - `deleteCourse(rxId)` — confirm dialog → `DB.deletePrescription()` → `renderDashboard()` → toast
  - `DB.deletePrescription(id)` added to `db.js`
  - `renderHistory()` — completed courses injected as synthetic entries with: drug name, days, doses/day, doses done/total, start–end dates
- **Version:** beta.33 / madhom-v51
- **Regression:** passed

---

# Current Architecture

## DB (`js/db.js`)
- LocalStorage-based state with `save()`/`load()`
- `migrateRx()` — auto-migration on load for old records
- **Prescription model:** `{ id, childId, productId, isCourse, totalDays, dosesPerDay, doseLog[], status, startAt, endAt, reminder }`
- Key methods: `addPrescription`, `updatePrescription`, `deletePrescription`, `logCourseDose`, `courseProgress`, `feed`

## App (`js/app.js`)
- IIFE module, exports via `return {}` → `window.App`
- Redux-style: DB is the single source of truth, UI reads from DB on every render
- COURSE helpers: `_activeCourses`, `_courseNextDoseAt`, `_courseIsDoseOverdue`, `_courseSummary`, `_dosesTodayCount`, `_activeTreatmentState`
- Sheet state variables: `courseChildId`, `courseDrugSel`

## UI (`index.html`)
- Bottom Sheets: `sheet-dose`, `sheet-med`, `sheet-temp`, `sheet-editkid`, `sheet-course`
- Dashboard containers: `dash-hero`, `dash-timeline`, `dash-active-treatments`, `qa-grid`
- History screen: `screen-hist` with `hist-list`, `hist-filters`

## Developer Center (`js/developer-console.js`)
- **Frozen** — no new features
- Tabs: Timeline, Logs, Errors, Network, Database, Storage, Health, Tools, Export
- Features: Search, Filters, Replay, Event IDs, Session IDs, Snapshot, Share, Copy, Ring Buffer

## MEDICATION_CATALOG
- `PRN`: אקמול/נובימול, קלונקס, נורופן/אדוויל/גורופן
- `DAILY`: ויטמין D
- `COURSE` (Step 2A): מוקסיפן, אמוקסיצילין, אוגמנטין

---

# Pending Tasks

| Step | Description | Files |
|------|-------------|-------|
| Step 4A | Progress bar on active treatment card (days elapsed / remaining) | `app.js` |
| Step 4B | Overdue dose badge / visual alert on dashboard | `app.js` |
| Step 5A | Push notifications for course doses | `app.js`, `sw.js` |
| Step 5B | Edit active course (change days/doses) | `app.js`, `index.html` |
| Step 6A | Add more COURSE drugs to catalog | `app.js` |
| Step 6B | Dose calculator support for COURSE drugs | `app.js` |

---

# Next Step

**Step 4A — Progress Bar**
- **Goal:** Show visual progress on each active course card (days/doses elapsed vs total)
- **Files expected:** `js/app.js` only
- **What to build:** `_courseProgressBar(rx)` → returns HTML string with a simple progress bar (dosesDone / totalDoses)
- **Guardrails:**
  - No new Bottom Sheet
  - No DB changes
  - No JS changes outside `_renderActiveTreatmentsCard`
- **Regression:** syntax check, no duplicates, no regressions on existing card rendering

---

# Known Issues

- `_activeTreatmentState()` still exists from Step 1D but is no longer used by the card (Step 3B rewrote the card to read from DB directly). Not a bug — can be cleaned up in a future refactor step.
- `confirm()` for delete is a browser native dialog — not styled to match app theme. Acceptable for now.
- Completed courses remain in `prescriptions[]` array in DB (status: 'completed'). They are only filtered out of the card but still take up space. Future: archive or prune old completed courses.

---

# Decisions

| Decision | Reason | Do NOT do |
|----------|--------|-----------|
| `productId` points to `MEDICATION_CATALOG` — no free-text `name` on Prescription | Keep architecture clean, names can change but IDs never should | Never add `Prescription.name` free text |
| COURSE drugs have no concentrations or dose calculator yet | Out of scope for this phase | Don't add safety engine / dose tables in this phase |
| `deletePrescription` is hard delete | Simplicity; completed courses go to history via `renderHistory` synthetic entries | Don't soft-delete or archive — keep it simple |
| `_dosesTodayCount` uses calendar day (00:00) not 24h rolling window | Matches parent mental model ("did I give the morning dose today") | Don't switch to rolling 24h without explicit request |
| Developer Center frozen | Avoid scope creep during Active Treatments phase | No new Dev Center features until phase complete |

---

# Guardrails

1. Work **one Step at a time** — never implement the next step without approval.
2. **Audit before implementation** — read the relevant code before writing any.
3. **Search for duplicates** before creating any new function.
4. **Regression before push** — syntax check + manual checklist.
5. **Stop after every Step** and wait for approval.
6. **No unrequested refactors** — don't touch working code that wasn't part of the Step.
7. **No contract changes** without explicit approval (DB schema, function signatures, exports).
8. **Update `PROJECT_PROGRESS.md`** at the end of every Step, before commit.
9. **Commit identity:** `{"name": "Claude", "email": "claude@anthropic.com"}` — required for Vercel deployment.
10. **Version bump every push:** App version (beta.N) + Cache version (madhom-vN) — both must increment together.

---

*Last updated: iOS SW update fix (SKIP_WAITING) — beta.49 / madhom-v77*
