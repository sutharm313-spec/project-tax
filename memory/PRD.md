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

## Implemented (2026-09-18)- Animated splash + 4 onboarding slides.
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

## Implemented (2026-09-18b) — Private Pricing + UPI manual verification
- Private client-specific pricing: NO public price anywhere (catalog/detail strip price, services list shows "View →", service detail shows assigned amount or "Private pricing"/"Contact us for pricing"). Prices assigned per Client+Service+FY (AY = FY+1). Server-authoritative: create_request 402s without an assigned price; amount snapshotted on request+invoice so later edits don't affect old orders.
- Admin pricing panel (client detail): search service, pick FY, set amount; list with Active/Inactive toggle (deactivate), pricing history sheet; bulk endpoint. All changes audited.
- UPI QR manual verification (no Razorpay): client sees QR + private amount, submits 12-digit UTR + optional payment screenshot (private GridFS). Status: Awaiting → Under Verification. Admin sets Payment Received / Under Verification / Payment Not Received; only "Received" unlocks that specific request's (one service + FY/AY) documents; flip re-locks. Payment history/audit + admin screenshot viewer via signed gridfile token.
- Verified end-to-end by testing agent: 21/21 pricing+UPI tests passed (public price hidden, price gating, snapshot immutability, UPI flow, screenshot, status unlock/re-lock, FY/AY scoping, RBAC, isolation, legacy /verify compat).

## Implemented (2026-09-18c) — PDF invoices, Recurring, Bulk pricing, Deadline reminders
- Branded PDF invoice/receipt (reportlab): client GET /client/invoices/{id}/pdf + admin /admin/invoices/{id}/pdf; unpaid=Invoice, paid=Receipt with PAID watermark; cross-tenant blocked. Client payments screen has PDF/Receipt buttons (openAuthedFile: web blob, native share).
- Recurring services: admin plans (client+business+service+FY+frequency+amount+next_due) auto-create request+invoice each period; scheduler runs on startup + POST /admin/recurring/run; next_due advances; pause/resume. Admin screen /admin/recurring. Auto-creates client_price if missing so auto requests are payable.
- Bulk pricing: /admin/pricing screen sets one service's price across many selected clients+FY via /admin/prices/bulk.
- Deadlines & document-expiry: /admin/deadlines screen create/list/soft-delete; POST /admin/deadlines/run-reminders (also on startup) notifies client + staff within reminder window (once/day). 
- Verified by testing agent: 22/22 (fixed soft-deleted deadlines still listed).
- Deadline Calendar: /admin/deadlines has List/Calendar toggle; month grid with prev/next, per-day urgency-coloured count badges (≤7d/≤30d/later), today highlight, tap-a-day detail sheet with delete.

## Implemented (2026-09-18e) — Admin delete (soft-delete) + real-time dashboard
- Delete (confirm sheet) on Admin: Clients (cascades businesses/requests/invoices/payments/documents/prices/recurring/deadlines/tickets/notifications; deleted client can't log in), Catalog services, Payments (re-locks linked request+invoice if it was verifying), Service Requests (cascades invoices/payments/documents), CRM Leads.
- All SOFT deletes (deleted_at; recoverable). Every read (admin stats + all admin lists + client overview/requests/payments/invoices/documents) excludes deleted via _alive(), so dashboard counts/totals update in real time (react-query invalidates admin-stats + affected keys).
- Fixed pre-existing revenue bug: stats + invoice PDF count payment status in (verified, received).
- Verified by testing agent: 16/16.

## Backlog- P1: PDF invoice/receipt generation (currently CSV reports + on-screen invoices); document expiry reminders scheduler; recurring service auto-creation.
- P1: real Razorpay/WhatsApp Cloud API/OCR wiring when user provides credentials (architecture + env placeholders ready).
- P2: dedicated GST/Audit/TDS structured workspaces (basic notes/workspace JSON in place); push notifications (on request); 2FA.

## Next Tasks
- Add branded PDF invoice + receipt download.
- Deadline/expiry reminder scheduler.
