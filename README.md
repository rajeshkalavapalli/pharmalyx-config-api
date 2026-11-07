# Pharmalyx API (pharmalyx-config-api)

### V 1.0.0

- For user creation  user designation dropdown values from the api is added 

### V 1.0.1

-  masterdata  example country , state creation  dropdown values from the api is added

### V 1.0.2

-  divisin  dropdown values from the api is added

### V 1.0.3

- Area  dropdown values from the api is added

### V 1.0.4

- Area  dropdown values from the api is added creation updated 

### V 1.0.5

- user divison and territoty id updated 

### V 1.0.6

- user multiple territoty mutiple areas updated  

### V 1.0.7

- user multiple territoty mutiple areas  maping is fixed 

### V 1.0.8

- user area mapping is updated  

### V 1.0.9

- Adeed Doctor  creation

### V 1.0.10

- Adeed stockist and pharmacy

### V 1.0.11

- edit view delete for area, user, division, territoty

### V 1.0.12

- fixed mapping pharmacy , stockist 

### V 1.0.13

- Added Tour Plan for the users

### V 1.0.14

- Tour plan day remarks, submitted and review details added, reject requires remarks

### V 1.0.15

- Added plan deviation api with approve and reject by reporting manager

### V 1.0.16

- Added my doctors api and doctor category, visits per month, birthday, anniversary fields

### V 1.0.17

- Added visits api with GPS, offline sync support and auto deviation

### V 1.0.18

- Added DCR api with manager approve and return

### V 1.0.19

- Added configuration summary api

### V 1.0.20

- Added login api and dashboard api

### V 1.0.21

- Added doctor engagement apis (catalogue, stock issue and return, RCPA, doctor business, feedback) and samples / gifts in visits

### V 1.0.22

- Dashboard api updated with doctor engagement, charts and team summary

### V 1.0.23

- Fixed user password update

### V 1.0.24

- Added role based tour plan apis (team plans and plan history)

### V 1.0.25

- Added secure login token, every api now requires sign in and user identity can no longer be changed from the browser

### V 1.0.26

- Added roles and permissions apis with on / off permission per role, user role assignment and deactivated users cannot sign in

### V 1.0.27

- Permissions changed to feature wise view, create, edit, delete and approve, with view required for other actions

### V 1.0.28

- Added pre-call planning api (doctors to meet as per tour plan with priority and doctor briefing)

### V 1.0.29

- Added pre-call plan apis (plan call objective, key messages, products, call order) and planned call marked visited when visit is logged

### V 1.0.30

- Added POB / Orders apis (book order with catalogue prices, free qty and discount, order status confirm / supplied / cancel, team orders) with orders permissions

### V 1.0.31

- Added Retailers and Stockists apis (assigned chemists / stockists with order business, pending supply, last RCPA and recent orders) with view permissions

### V 1.0.32

- Added Secondary Sales apis (monthly stockist statement, opening carried from last month closing, submit, manager approve / return) and stockist stock api (latest closing stock with cover days) with permissions

### V 1.0.33

- Added sales business summary api (POB, secondary sales and stock with six month trend, top products, stockists and customers) with view permission

### V 1.0.34

- Added Sales Plan apis (monthly product targets set by manager, achievement on secondary and POB supplied, team summary) and Doctor Business Plan apis (doctor wise visits, Rx units per product and support, submit, manager approve / return, achievement from visits, RCPA and POB) with permissions

### V 1.0.35

- Added Expenses apis (DA / TA rate card per designation, monthly claim from approved DCRs, other expenses with monthly limit, manager approve / reduce / return, finance final approve and mark paid) with permissions

### V 1.0.36

- Added today schedule (pre-call plan and today visits) to the dashboard api

### V 1.0.37

- Added planned calls per day and territory coverage (covered / pending / not planned, top territories) to the dashboard api

### V 1.0.38

- Added team planned calls per day, team members today status and team territory coverage to the dashboard api

### V 1.0.39

- Added reports framework (hierarchy scope at every level, report filters) and DCR / Call report api with permissions

### V 1.0.40

- Added MIS, Coverage, KPI, Missed Visits, POB, Sales and Graphical report apis with hierarchy scope and permissions

### V 1.0.41

- Added Insights apis (rule based alerts for doctors, reps and stock with admin editable thresholds and acknowledge / resolve, performance trends, field intelligence, doctor segmentation, pareto and month end forecast) with permissions

### V 1.0.42

- Added approvals inbox api (all pending approvals for the signed in user, approve / return tour plans, deviations and DCRs using the existing rules)

### V 1.0.43

- Added HR apis (attendance check in / out and month status, leave types / balances / apply / approve / cancel, activity timeline, appraisal cycles with self and manager review and KPI based final score), leave in the approvals inbox, with permissions

### V 1.0.44

- Doctor verification phase 0 and 1: doctor create / edit / delete now need master permissions, admin doctor changes recorded in the audit log, database script for doctor status, clinic GPS, doctor requests with comments, evidence, verifications, duplicate and fraud flags

### V 1.0.45

- Added doctor requests apis (new doctor with GPS and photo, edit / delete with reason, primary manager approval with typed reason when flagged, audit log), duplicate detection (name normalising, fuzzy match, same speciality within 2 km, same phone / registration no., same GPS spot) with scan of existing doctors, and doctor requests in the approvals inbox

### V 1.0.46

- Added doctor verification apis (submit proof, primary manager accept / reject, joint visit verification only after a real visit, deadline extension with reason, audit log), verification proofs in the approvals inbox and doctor verification overdue alert in risk and alerts


### V 1.0.47

- Added GPS fraud checks when a visit is logged (distance from clinic with GPS accuracy allowance, same spot for many clinics, impossible travel, mock GPS, no GPS) saved as flags for the manager without blocking the visit, clinic location in my doctors and GPS and location rules in risk and alerts


### V 1.0.48

- Added resend of rejected doctor requests (only by the requester, once per rejection, not for confirmed duplicates), linked to the rejected request and saved in the audit log, rejected new doctor goes back to pending with the fixes, and a lock so a doctor never has two pending requests


### V 1.0.49

- Doctors list and doctor details open for anyone with my doctors view, limited to doctors assigned to or added by them and their team; admins with master data view still see all doctors; create, edit and delete stay admin only


### V 1.0.50

- Doctors list returns approval status and whether the doctor is assigned to the user, used to allow edit / delete requests only on own approved doctors


### V 1.0.51

- Doctor requests also carry country, state, date of birth and anniversary from the full doctor form (new doctor, edit and resend)


### V 1.0.52

- Doctor requests are approved by the requester's current primary manager (follows manager changes; admin when there is no manager), and approve / reject is shown only when the role has doctor requests approve


### V 1.0.53

- Doctor edit requests can change active / inactive status (applied after manager approval); new doctor requests always start active


### V 1.0.54

- Added verified work: STP with head office approval and monthly plan generation, territory boundaries (auto around doctors or entered points) with head office exceptions (doctor, leave cover, special duty), automatic day start with head office flag when outside the territory, live check-in / check-out visit validity (minimum stay, clinic radius, vehicle movement, mock GPS, territory, overlap, leave) decided by the system with audited head office overrides, hospitals for multi-doctor locations, location consent and work-hour pings, TA from GPS distance and DA only with enough valid visits, tour plan changes inside the territory without manager approval, sample given-by stamping and physical stock counts, one doctor per MR on new mappings, and rule values editable per company (migration: controllers/VerifiedWork/schema.sql)


### V 1.0.55

- Standard tour plan returns the acting user's direct reports (whose plan they may prepare)


### V 1.0.56

- Standard tour plan can be taken back from head office (back to draft) by the MR or their manager while it is waiting, saved in the audit log


### V 1.0.57

- Added business tracking (migration: controllers/BusinessTracking/schema.sql): product batches, primary dispatch and returns per stockist territory with void instead of delete, net sales per territory per month (shared territories split), POB slip photo + GPS within the chemist radius + follow-up / verify workflow with audit, automatic order checks (inflated quantity, large first order, no reorder, month-end spike, reused slip photo) as head office flags, near-expiry alerts, ramp-up milestones, cost vs business, incentive slabs with 3-month holdback and return deductions, monthly review, POB follow-up in the approvals inbox


### V 1.0.58

- Fixed days off in tour plans never saving (the database accepts non_working, the app sent non-working): saved as non_working and read back as non-working everywhere; fixed the business tracking migration failing on the slip photo index (index now created after the column exists)


### V 1.0.59

- Added dashboard module data (/dashboard/modules/:section): headline numbers and bar chart series per module for my work or my team (hierarchy; head office sees all), read-only


### V 1.0.60

- Dashboard module data for reports and analytics: call average and coverage by month, missed doctors by class, top representatives, DCRs submitted, POB orders


### V 1.0.61

- Dashboard modules: each chart now carries a chart type (line, donut, rank, bar) and each headline number a 6-month sparkline and % change vs last month


### V 1.0.62

- Field ledger module (controllers/FieldLedger, migration schema.sql): MR saleable stock ledger with stock limit and holding-age flags, direct supply to chemists (stamped receipt photo, GPS radius, catalogue price), chemist ledger with ageing, payments (with MR until head office confirms), credit limits; new deliveries and POBs blocked when dues are over the limit or older than 60 days; schemes and special prices by head office; exit clearance with automatic handover on the leaving date; reports: stockist fill rate, spend vs business, focus
- Doctor spend module (controllers/DoctorSpend, migration schema.sql): allowed activity types, MR request, manager recommendation, head office approval with compliance check, disbursement with document, outcome vs territory net sales, recommendation scores, flag for doctors with an earlier failed claim, reports
- POB_UNSUPPLIED flag to head office when a POB is not supplied within N days (default 4)
- New rule values in Settings (unsupplied days, fill rate, MR stock limit and hold days, due block days, spend ratio, focus visit value, spend outcome thresholds)
- Tests: npm test runs tests/*.test.js (41 tests)


### V 1.0.63

- updated one to many organisations


### V 1.0.64

- Ready for Render + Azure SQL: port from `PORT`, `npm start`, `DB_ENCRYPT=true` for Azure, `CORS_ORIGINS` to allow only the hosted web apps
- Fixed `require('../Users/UserService')` letter case (crashed on Linux / Render)
- Softer wording for GPS checks and alerts: "Location app detected", "Unusual travel time", "Very short visit", "Review alerts" (no "fake" / "fraud" words shown to users)
- Tour plan: areas of the user's assigned territories count as their own (a newly added territory can be planned); an unplanned Sunday is saved as an off day
- New company rule TOUR_PLAN_APPROVAL (Rules / Settings): 1 = confirmed tour plans go to the reporting manager for approval, 0 = approved straight away inside the territory (default); rules added later can be saved for the first time from Settings
- Review alerts go up the reporting line (ASM, RSM, ZSM ... head office), never to the person they are about; employees see a neutral "in review" status for their own TA / DA days and visits
- Joint work (controllers/JointWork, tables JointWorkDays and VisitJointWorkers, run the SQL in SSMS): ask managers / team / territory colleagues to work a day together, they confirm or decline, the day's visits carry the colleagues automatically, coaching feedback (1-5 rating + notes) shown to the field person; API /app/joint-work


### V 1.0.65

- Joint work in the tour plan (column TourPlanDetails.JointWithUserId, run the SQL in SSMS): a senior (ASM, RSM ...) plans a day as "joint work with <team member>"; the area is the team member's planned area for that date; no acceptance needed in the hierarchy
- Clash checks: a senior can't plan joint work on the team member's off day, an unplanned Sunday or a day of pending / approved leave; only own team members (any level below)
- Saving the plan (not as a draft) confirms the joint days and locks them in the team member's plan: they can't make it an off day or change the area, only fill the area while it is empty
- A senior can move a team member's planned day to another area (POST /app/tourplan/team/:userId/day); it is recorded in the team member's plan as an approved deviation "Changed by <senior> for joint work"
- Leave: applying for leave on a joint day warns the person; approved leave cancels the joint day and the senior gets a "replan" alert
- My Day (/app/work/today) shows today's joint work; alerts show joint days a senior planned with me in the next week
- Joint work days planned from the tour plan can't be cancelled or declined from the Joint Work page


### V 1.0.66

- Uploaded files (doctor signboard photos, order slips, delivery receipts, spend documents) can be stored in the database: set `FILE_STORE=db` (table dbo.FileBlobs, run the SQL in SSMS). Hosts without a lasting disk (Render) keep the files across deploys
- Without the table, or without `FILE_STORE=db`, files stay in the uploads folder as before; files saved in the folder earlier still open after the switch


### V 1.0.67

- Phone notifications through the Expo push service (utils/push.js, table dbo.PushTokens, run the SQL in SSMS): POST / DELETE /app/push/token registers the signed-in person's phone
- Sent for: tour plan sent for approval (to the manager), approved / returned (to the owner), joint work days planned by a senior (to the team member), joint work request and answer, leave applied (to the manager) and decided (to the employee), DCR approved / returned, TA / DA day decided by the manager or head office
- Notifications never block or fail the action; tokens Expo reports as not registered are removed


### V 1.0.68

- Fixed "Failed to send the new doctor": the phone's Add doctor form has no country / state (NOT NULL on dbo.Doctor), so they are now taken from the territory's state (utils/placeOfTerritory.js); same for a rejected new doctor sent again
- Admin create doctor accepts the phone's column-name keys (DoctorName, TerritoryId, ...) as well as the web form's camelCase keys; create / update fill a missing country / state from the territory
- Pharmacy and stockist create / update: clear 400 message when owner, phone, address, territory or area is missing, country / state from the territory when blank, optional columns default to empty; their errors now return a readable message instead of "Internal Server Error"
- Data import: doctors, chemists and stockists use the row's State column first, then the territory's; a new row whose territory has no state is marked as an error instead of failing the whole import


### V 1.0.69

- Samples / gifts: an admin (masters.edit) can now issue stock to anyone in the company, not only the reporting manager; nobody can issue to themselves
- GET /app/stock/recipients: who the signed-in person can issue to (direct reports, or everyone active for an admin)
- Stock balances / history: an admin can open any person's stock; managers can open anyone in their team (all levels below)


### V 1.0.70

- Team view widened: managers see everyone below them (all levels, not only direct reports) and head office / admin (reports.viewall or masters.edit) sees the whole company; approving still stays with the reporting manager
- utils/access canViewUser + resolveViewUser use the reporting hierarchy (RCPA, pre-call, doctor business, doctor plan, feedback, sales plan, samples / gifts)
- Opening a person's DCRs, visits, doctors, tour plans, deviations, doctor plans and secondary statements follows the same rule
- Orders and sales business "My team", the team picker (/app/my-doctors/team) and the dashboard team figures cover the whole team (reportScope.teamIdsJson / IN_TEAM)
- Reports and insights: admin (masters.edit) counts as head office and sees everyone
- Tour plan of a team member opens for managers above and head office too (edit stays with the owner, approve with the reporting manager)


### V 1.0.71

- Sign-in protection (utils/loginLimiter.js): 5 wrong passwords for a login name lock it for 15 minutes; 20 wrong passwords from one address in 15 minutes block that address for 15 minutes; answered with 429 and the minutes left
- Security headers with helmet (nosniff, HSTS, frame protection, no X-Powered-By); files stay readable by the web app (cross-origin resource policy)
- CORS: when CORS_ORIGINS is not set on a hosted server, only our sites may call the API (demo / app / www .pharmalyx.in and the Render web app); local machines still allow any origin; the phone app is not affected
- trust proxy on, so the caller's address is right behind Render


### V 1.0.72

- GET /app/dashboard/overview (Dashboard/OverviewService.js): month headline for the team / company (visits today and this month, verified %, POB, secondary sales, chemist deliveries, collections and cash still with MRs), leaderboard of the people below (visits, valid %, doctors, POB, DCRs), latest field activity (visits, orders, deliveries, payments, DCRs, leave; last 7 days) and attention counts (payments to confirm, missed DCRs, low sample / gift stock, not in the field today)
- Overview: collections shown as positive amounts (payments are stored as negative ledger entries)
- Overview: office admins (designation ADMIN) are left out of the leaderboard, the people count and "not in the field today"
- Dashboard header "reps" count also leaves out office admins and inactive people (matches the overview)
