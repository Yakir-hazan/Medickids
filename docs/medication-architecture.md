# ארכיטקטורת תרופות — מסמך תכנון

> נכתב: 27.7.2026, עודכן: 27.7.2026 (v3 — Phase 1 של מודל 5 השכבות מומש ב-beta.17).
> **סטטוס**: Phase 1 בוצע (Ingredient/Product/Protocol נפרדים + Prescription ל-PRN/Daily,
> ראו "מה מומש בפועל" למטה). Phase 2 (Course/אנטיביוטיקה) עדיין לא התחיל.

## הבעיה שהתגלתה אחרי beta.16

`DOSE_DB` השטוח מערבב שתי שכבות שונות לגמרי באותו אובייקט: גם **מוצר מסחרי** (`matchNames`,
`concentrations`, יצרן) וגם **פרוטוקול טיפול** (`intervalHours`, `maxDosesPerDay`,
`treatmentType`). זה עובד כשיש רק PRN + Daily, אבל נשבר ברגע שמוסיפים Course (אנטיביוטיקה) —
כי אין שום מקום לשמור **טיפול פעיל של ילד ספציפי** (מתי התחיל הקורס, כמה ימים נשארו, מתי הוא
נגמר ונעלם מהדשבורד). השם `DOSE_DB` עצמו כבר לא מתאר את מה שהוא מכיל.

## המודל המתוקן — 5 שכבות

### 1. Active Ingredient (חומר פעיל) — האמת הרפואית
```
paracetamol, ibuprofen, amoxicillin, cetirizine, salbutamol, ...
```
נשמר: שם, קטגוריה, כללי בטיחות, בעתיד — אינטראקציות בין חומרים.

### 2. Medication Product (מוצר מסחרי)
```
אקמול ילדים, נובימול, דקסמול   →   ingredient = paracetamol
```
לכל מוצר: יצרן, ריכוזים, צורות מתן (סירופ/טיפות/נרות/טבליות). **אין כאן שום דבר על תזמון.**

### 3. Treatment Protocol (פרוטוקול טיפול) — השכבה שהייתה חסרה
לא `intervalHours` בודד — אלא **סוג מנוע לוגי** שמגדיר את כל ההתנהגות:

| פרוטוקול | כללים |
|---|---|
| **PRN** | מרווח מינימלי, מקסימום מנות ביממה, התראה אם מוקדם מדי |
| **Course** (קורס) | X פעמים ביום, Y ימים, מעקב מנה שנשכחה, כמה נשארו, מתי מסתיים |
| **Daily** | פעם ביום, תזכורת קבועה, בדיקה האם כבר ניתן היום |
| **Weekly** | פעם בשבוע |
| **Scheduled** | שעות קבועות שלא בהכרח יומיות/שבועיות |

### 4. Prescription (טיפול פעיל של ילד) — **מושג חדש, לא קיים היום**
לא כל תרופה בקטלוג היא טיפול פעיל. Prescription = מופע קונקרטי: "לנויה יש קורס אמוקסיצילין,
3 פעמים ביום, 7 ימים, התחיל 12/7, נגמר 19/7". אחרי שהקורס נגמר — הוא לא מופיע יותר בדשבורד.
זה האובייקט שמאפשר גם "יום 3 מתוך 7" וגם ספירת מנות שנשכחו.

### 5. Administration (רישום מתן בפועל)
זה מה שכבר קיים היום (`medEntries`) — "20:15, נתתי אמוקסיצילין". זו פעולה שבוצעה, לא הגדרת
הטיפול. ברפקטור, רשומת Administration תצביע על `prescriptionId` (אם יש טיפול פעיל מתאים).

## היתרון של ההפרדה
קטלוג תרופות (Ingredient→Product→Protocol) נפרד מטיפול פעיל (Prescription) נפרד מרישום מנה
(Administration) — כל שכבה פשוטה בפני עצמה, וכל הלוגיקה (אזהרות, תזכורות, דשבורד) קוראת מהשכבה
הנכונה במקום מאובייקט אחד עמוס.

## שינוי שם
`DOSE_DB` → `MEDICATION_CATALOG`, עם מבנה מקונן: `{ ingredients, products }` (הפרוטוקולים
חיים בתוך ה-product כברירת מחדל, אבל ה-Prescription יכול לדרוס אותם לכל ילד).

## מה לא לעשות עכשיו
לא להכניס 150 תרופות. לבנות קודם את התשתית (5 השכבות + מסך "התחלת טיפול" שיוצר Prescription),
ואז להוסיף קטלוג בהדרגה: פרצטמול, איבופרופן, אמוקסיצילין, אוגמנטין, אזניל, ויטמין D, ברזל,
זירטק, פניסטיל, ונטולין. אם הארכיטקטורה נכונה — הוספת תרופה חדשה תהיה בעיקר הוספת נתונים,
לא כתיבת לוגיקה חדשה.

## החלטות שהתקבלו ומה שמומש (27.7.2026, beta.17)

- **Scope לשלב א׳**: PRN (חום/כאב) + יומי קבוע (ויטמינים). **בוצע.**
- **מיגרציה**: מיפוי אוטומטי לפי שם — ההתאמה הקיימת (`matchNames`/substring) כבר עושה זאת,
  לא נדרש סקריפט נפרד. **בוצע.**
- **מבנה Prescription**: `state.prescriptions` מערך גלובלי עם שדה `childId` בכל רשומה (לא מקונן
  בתוך הילד) — קל יותר לשאילתות כמו "אילו טיפולים פעילים היום". **בוצע.**
- **מסך "נתתי תרופה"**: לא מפוצל לשניים, והמשתמש לא בוחר PRN/Daily ידנית — **סוג התרופה
  שנבחרה קובע את ה-UI**: PRN מקבל את בורר "אוטומטי/מותאם אישית" הרגיל, DAILY מקבל טוגל "להזכיר
  כל יום / בלי תזכורת קבועה" שיוצר/מעדכן Prescription בשקיפות. **בוצע.**
- **TREATMENT_TYPES enum מרכזי** (`PRN`/`DAILY`/`COURSE`/`WEEKLY`/`CUSTOM`) במקום מחרוזות
  מפוזרות בקוד. **בוצע** — COURSE/WEEKLY מוגדרים כ-placeholder לשלב ב׳, שום מוצר לא משתמש בהם עדיין.

### מה מומש בפועל בקוד
- `DOSE_DB` → `MEDICATION_CATALOG`, עם הפרדה אמיתית: Product (`matchNames`/`concentrations`)
  מול Protocol מקונן (`protocol: { type, intervalHours, maxDosesPerDay, interval }`).
- `ACTIVE_INGREDIENTS` נשאר שכבה עצמאית עם `name` בלבד — `treatmentType` הועבר ל-Protocol
  (הפרוטוקול שייך למוצר, לא לחומר הפעיל — כמו שהוגדר במודל).
- `db.js`: נוסף `state.prescriptions` + CRUD (`addPrescription`/`updatePrescription`/
  `activePrescriptionsFor`), ומיזוג ברירות מחדל ב-`load()` כדי ששדה חדש לא ישבור משתמשים ותיקים.
- `saveMed()`: לתרופה מסוג DAILY עושה upsert ל-Prescription (מוצא קיים לפי child+productId
  או יוצר חדש) ומקשר את רשומת ה-Administration אליו (`entry.prescriptionId`).
- `_doseHistoryWarning` ו-`scheduleDoseReminder` קוראים את סוג הפרוטוקול מ-`drug.protocol.type`.

### מה עדיין לא קיים (במכוון — שלב ב׳)
- Course (אנטיביוטיקה): ספירת ימי קורס, מנה שנשכחה, סיום אוטומטי — שום מוצר עדיין לא מוגדר COURSE.
- הדשבורד עוד לא מציג רשימת Prescriptions פעילים — ה-Prescription נשמר אך לא מוצג מעבר לטוגל עצמו.

## Audit ארכיטקטוני לפני Phase 2 (27.7.2026, beta.18)

לפני שממשיכים ל-Course, בוצע Audit ממוקד על ארבע הישויות (ACTIVE_INGREDIENTS /
MEDICATION_CATALOG / PRESCRIPTIONS / MED_ENTRIES) סביב שאלת ה-Single Source of Truth.

### ממצאים
- **Product↔Ingredient**: ✅ תקין — המוצר מפנה ל-`activeIngredient` בלבד, השם עצמו חי רק ב-
  `ACTIVE_INGREDIENTS`, אין כפילות.
- **Prescription↔Catalog (ערכים)**: ✅ תקין — Prescription מעולם לא שמר `intervalHours`/
  `maxDosesPerDay` כפולים; תמיד קרא אותם מה-catalog.
- **Prescription↔Catalog (זהות)**: ❌ **נמצא ותוקן**. `Prescription.medicationKey` הצביע על השם
  העברי שמשמש גם כמפתח האובייקט ב-`MEDICATION_CATALOG` — לא מזהה יציב. אם השם המוצג משתנה, ההפניה
  נשברת בשקט.
- **Prescription.active בוליאני**: ❌ **נמצא ותוקן**. אין מקום ל-`completed`/`cancelled` שיידרש
  לקורס אנטיביוטיקה.
- **ACTIVE_INGREDIENTS דל**: ❌ **נמצא ותוקן**. היה `{name}` בלבד, בלי `id`/`aliases`.
- **Protocol בלי גרסה**: ❌ **נמצא ותוקן**. אין `version` שיאפשר לשנות המלצות מינון בעתיד בלי לשבור
  נתונים היסטוריים.

### התיקונים שבוצעו
- לכל מוצר ב-`MEDICATION_CATALOG` נוסף `id` יציב (`novimol_drops`, `acamol_syrup`,
  `nurofen_syrup`, `vitamin_d_drops`) — נבדק שהם ייחודיים. מפתח האובייקט (השם העברי) נשאר
  לצורך התאמת טקסט חופשי בלבד (`matchNames`/`_matchesDrug`), לא משמש יותר כמזהה בפועל.
- `ACTIVE_INGREDIENTS` שודרג ל-`{ id, name, aliases }` לכל חומר פעיל.
- כל `protocol` קיבל `version: 1`.
- סכמת `Prescription` שונתה ל: `{ id, childId, productId, ingredientId, protocolType, status
  ('active'|'completed'|'cancelled'), startAt, endAt, reminder: { on } }`. `productId`/
  `ingredientId` מצביעים על ה-id היציבים, לא על השם המוצג.
- נוספה `_catalogEntryById(productId)` לצד `_catalogEntryFor(medicineName)` הקיימת.

### הערת מיגרציה
בשלב הזה עוד לא נוצרו Prescriptions אמיתיים בסביבת הפרודקשן (הפיצ'ר עלה רק ב-beta.17), אז לא
נדרש סקריפט מיגרציה בפועל — פשוט שינינו את הסכמה לפני שהיא "התקבעה" עם נתונים אמיתיים. זו בדיוק
הסיבה שה-Audit הזה נעשה עכשיו ולא אחרי עוד כמה שבועות.

### מסקנה
ה-Audit יצא "נקי" אחרי התיקון — אין יותר כפילות ערכים בין השכבות, וההפניות (Product↔Ingredient,
Prescription↔Product/Ingredient) עוברות דרך id יציב ולא שם תצוגה. אפשר להתחיל Phase 2 (Course).
