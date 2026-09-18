# taxman.manoj — Product Requirements Document

## Brand
taxman.manoj — "Your Compliance. Simplified." Premium tax & compliance client portal.

## Original Problem Statement
Production-ready premium mobile-first client portal + secure web-based Admin/Staff dashboard for a professional tax & compliance business. Deep-navy fintech design, real auth, document management with payment-gated access, payments, notifications, workflows, CRM, reports, admin controls. Not a static prototype.

## User Choices
- Payments: UPI (client submits 12-digit UPI reference, admin verifies server-side) — replaces Razorpay per user.
- OTP: Email OTP via Emergent managed email (preview echoes code via OTP_DEV_ECHO).
- Languages: English + Hindi toggle.
- Admin/Staff dashboard: same app, desktop-optimized `/admin` web route.

## Architecture
- Backend: FastAPI (port 8001), MongoDB (motor), GridFS bucket `secure_docs` for PRIVATE document storage. JWT access/refresh, bcrypt passwords, rate limiting, RBAC. Routers: auth, client_api, admin_api. Core helpers in core.py/security.py/storage.py/notify.py/common.py/seed.py.
- Frontend: Expo Router (React Native + web). Providers: I18n, Auth, ClientApp (business/FY), Toast, React Query. Theme in src/theme.ts (navy palette). Shared UI kit in src/ui.tsx.
- Data model: users, clients, businesses, service_catalog, service_requests, documents(+versions), payments, invoices, notifications, tickets(+messages), internal_notes, leads, audit_logs, document_access_logs, deadlines, settings, otps, counters.

## Personas
- Client: individuals/businesses needing ITR/GST/accounting/TDS/audit/registration services.
- Staff (accountant/tax/gst/support/manager): scoped by granular permissions.
- Super Admin/Admin: full control, verify payments, review docs, manage staff/catalog/settings.

## Core Requirements (static)
- Client isolation (server-enforced), document upload always free, view/download locked until payment verified server-side (independent re-check on every file token + streaming), audited manual unlock, branded emails, WhatsApp deep-link fallback (no fake API), bilingual, premium motion.

## Implemented (2026-09-18)
- Animated splash + 4 onboarding slides.
- Auth: register → email OTP verify, login (rate-limited, brute-force protected), forgot/reset, refresh, logout, unique Client ID (TM-000001…).
- Client dashboard: business & FY switchers, animated metrics, Action Center, deadlines, recent requests, profile completion.
- Services marketplace (27 seeded services, 6 categories, search/chips) → service detail → request.
- Service request detail: progress timeline, dynamic document checklist, upload (camera/gallery/files) before payment, UPI payment sheet (QR + VPA + reference), ITR income workspace.
- Secure documents vault: status badges, lock/unlock, replace/versioning, signed 5-min file tokens.
- Payments: invoices, UPI initiate + reference submission, history.
- Notifications center (read/unread), support tickets + chat.
- Profile: edit, businesses, language toggle (EN/HI), legal (privacy/terms/refund), logout.
- Admin web dashboard (/admin): analytics (cards + charts), payment verification queue, document review + audited unlock, requests pipeline + staff assignment, clients + internal notes, CRM leads, tickets inbox, catalog manager, staff & permissions, settings (business/UPI), global search, CSV reports, audit trail.
- Verified end-to-end by testing agent (30/32) + fixed GridFS bucket + file-token import + login JSON body + admin useTheme/useStyles.

## Backlog
- P1: PDF invoice/receipt generation (currently CSV reports + on-screen invoices); document expiry reminders scheduler; recurring service auto-creation.
- P1: real Razorpay/WhatsApp Cloud API/OCR wiring when user provides credentials (architecture + env placeholders ready).
- P2: dedicated GST/Audit/TDS structured workspaces (basic notes/workspace JSON in place); push notifications (on request); 2FA.

## Next Tasks
- Add branded PDF invoice + receipt download.
- Deadline/expiry reminder scheduler.
