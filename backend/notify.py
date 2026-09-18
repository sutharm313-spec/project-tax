# Branded email (Emergent managed email), in-app notifications, audit trail,
# WhatsApp deep-link templates. Secrets stay server-side.
import logging
import os
import re
import ipaddress
from html import escape
from html.parser import HTMLParser
from urllib.parse import quote, urlparse

import httpx
from fastapi import HTTPException

from core import COLL, db, iso, now

logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"  # constant, survives deployment
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME", "taxman.manoj")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")
APP_URL = os.environ.get("APP_PUBLIC_URL", "https://taxman.manoj")

BRAND = "taxman.manoj"
TAGLINE = "Your Compliance. Simplified."

NAVY = "#0A0F1D"
BLUE = "#2563EB"

# ---------------- Guardrail gate (G2/G3) — copy from playbook ----------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def send_email(*, to: str, subject: str, html: str, reply_to: str | None = None) -> str | None:
    _assert_safe_email(subject, html)
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if reply_to or EMAIL_REPLY_TO:
        payload["contact_email"] = reply_to or EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        email_id = resp.json().get("id")
        await db[COLL["email_log"]].insert_one(
            {"to": to, "subject": subject, "template": subject, "provider_id": email_id, "sent_at": now()}
        )
        return email_id
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        return None
    except ValueError as e:
        logger.error(f"Email blocked by guardrail: {e}")
        raise
    except Exception as e:
        logger.error(f"Email send error: {e}")
        return None


def branded_html(title: str, body_html: str, cta_label: str | None = None) -> str:
    cta = ""
    if cta_label:
        cta = (
            f'<a href="{APP_URL}" style="display:inline-block;background:{BLUE};color:#ffffff;'
            f'text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:600;font-size:14px">{escape(cta_label)}</a>'
        )
    return f"""<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0F1D;padding:32px 12px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#111827;border-radius:20px;border:1px solid #334155">
    <tr><td style="padding:32px 36px 8px 36px;font-family:Arial,sans-serif">
      <div style="font-size:20px;font-weight:700;color:#FFFFFF">{BRAND}<span style="color:{BLUE}">.</span></div>
      <div style="font-size:11px;color:#64748B;letter-spacing:1px;text-transform:uppercase">{TAGLINE}</div>
    </td></tr>
    <tr><td style="padding:12px 36px 8px 36px;font-family:Arial,sans-serif">
      <div style="font-size:18px;font-weight:600;color:#F8FAFC">{escape(title)}</div>
    </td></tr>
    <tr><td style="padding:4px 36px 16px 36px;font-family:Arial,sans-serif;font-size:14px;line-height:22px;color:#CBD5E1">
      {body_html}
    </td></tr>
    <tr><td style="padding:8px 36px 20px 36px;font-family:Arial,sans-serif">{cta}</td></tr>
    <tr><td style="padding:16px 36px 28px 36px;border-top:1px solid #1E293B;font-family:Arial,sans-serif">
      <div style="font-size:11px;color:#64748B">Sent by {BRAND}. We never ask for your password or card details by email.</div>
    </td></tr>
  </table>
</td></tr></table>"""


# ---------------- Email triggers ----------------
async def email_otp(to: str, code: str, purpose: str) -> None:
    title = "Verify your email" if purpose == "register" else "Password reset code"
    body = (
        f"<p>Your one-time verification code is:</p>"
        f'<p style="font-size:28px;font-weight:700;letter-spacing:8px;color:#FFFFFF">{escape(code)}</p>'
        f"<p>This code is valid for 10 minutes. If you did not request it, you can safely ignore this email.</p>"
    )
    await send_email(to=to, subject=f"{code} is your {BRAND} verification code", html=branded_html(title, body))


async def email_payment_verified(to: str, name: str, service: str, amount: str, invoice_no: str, receipt: str) -> None:
    body = (
        f"<p>Hi {escape(name)},</p>"
        f"<p>Your payment of <strong>{escape(amount)}</strong> for <strong>{escape(service)}</strong> has been "
        f"successfully verified. Your invoice <strong>{escape(invoice_no)}</strong> is settled.</p>"
        f"<p>You can now securely view and download your uploaded documents from your {BRAND} portal.</p>"
        f"<p>UPI Reference: {escape(receipt)}</p>"
    )
    await send_email(to=to, subject=f"Payment verified — {service} ({invoice_no})", html=branded_html("Payment verified", body, "Open portal"))


async def email_document_status(to: str, name: str, doc_name: str, status: str, note: str = "") -> None:
    body = (
        f"<p>Hi {escape(name)},</p>"
        f"<p>Document <strong>{escape(doc_name)}</strong> status: <strong>{escape(status.replace('_', ' ').title())}</strong>.</p>"
        + (f"<p>{escape(note)}</p>" if note else "")
        + f"<p>Open your {BRAND} portal to take action.</p>"
    )
    await send_email(to=to, subject=f"Document {status.replace('_', ' ')} — {doc_name}", html=branded_html("Document update", body, "Open portal"))


async def email_service_status(to: str, name: str, service: str, status: str) -> None:
    body = (
        f"<p>Hi {escape(name)},</p>"
        f"<p>Your service <strong>{escape(service)}</strong> is now <strong>{escape(status.replace('_', ' ').title())}</strong>.</p>"
        f"<p>Track progress anytime in your {BRAND} portal.</p>"
    )
    await send_email(to=to, subject=f"{service} — {status.replace('_', ' ').title()}", html=branded_html("Service update", body, "Track service"))


async def email_ticket_reply(to: str, name: str, subject: str) -> None:
    body = (
        f"<p>Hi {escape(name)},</p>"
        f"<p>Our team has replied to your ticket <strong>{escape(subject)}</strong>.</p>"
        f"<p>Open your {BRAND} portal to view the response.</p>"
    )
    await send_email(to=to, subject=f"New reply — {subject}", html=branded_html("Support update", body, "Open ticket"))


async def email_welcome(to: str, name: str, client_code: str) -> None:
    body = (
        f"<p>Welcome {escape(name)},</p>"
        f"<p>Your {BRAND} account is ready. Your Client ID is <strong>{escape(client_code)}</strong>.</p>"
        f"<p>Upload documents securely, request services, pay via UPI and track every compliance deadline in one place.</p>"
    )
    await send_email(to=to, subject=f"Welcome to {BRAND}", html=branded_html("Your account is ready", body, "Get started"))


# ---------------- In-app notifications ----------------
async def notify(user_id: str, title: str, body: str, kind: str = "info", ref: dict | None = None) -> None:
    await db[COLL["notifications"]].insert_one(
        {"user_id": user_id, "title": title, "body": body, "kind": kind, "ref": ref or {},
         "read": False, "created_at": now()}
    )


# ---------------- Audit + access logs ----------------
async def audit(actor_id: str, actor_role: str, action: str, target: str, details: dict | None = None) -> None:
    await db[COLL["audit"]].insert_one({
        "actor_id": actor_id, "actor_role": actor_role, "action": action, "target": target,
        "details": details or {}, "created_at": now(),
    })


async def log_doc_access(user_id: str, doc_id: str, action: str, granted: bool, reason: str = "") -> None:
    await db[COLL["access_logs"]].insert_one({
        "user_id": user_id, "document_id": doc_id, "action": action, "granted": granted,
        "reason": reason, "created_at": now(),
    })


# ---------------- WhatsApp deep links (no fake API sends) ----------------
WA_TEMPLATES = {
    "payment_verified": ("payment_verified", "Hello {client_name},\n\nYour payment for {service_name} has been successfully verified.\n\nYou can now securely view/download your uploaded documents from your taxman.manoj portal.\n\n— taxman.manoj"),
    "payment_reminder": ("payment_reminder", "Hello {client_name},\n\nA payment of {amount} for {service_name} is pending. Kindly complete it from your taxman.manoj portal.\n\n— taxman.manoj"),
    "document_required": ("document_required", "Hello {client_name},\n\nThe following documents are required for {service_name}: {docs}. Please upload them from your portal.\n\n— taxman.manoj"),
    "document_rejected": ("document_rejected", "Hello {client_name},\n\nYour document {doc_name} was rejected. Reason: {reason}. Please re-upload from your portal.\n\n— taxman.manoj"),
    "reupload_required": ("reupload_required", "Hello {client_name},\n\nPlease re-upload {doc_name} for {service_name}.\n\n— taxman.manoj"),
    "service_started": ("service_started", "Hello {client_name},\n\nYour {service_name} work has started. Track progress in your portal.\n\n— taxman.manoj"),
    "service_completed": ("service_completed", "Hello {client_name},\n\nYour {service_name} has been completed. Final documents are available in your portal.\n\n— taxman.manoj"),
    "deadline_reminder": ("deadline_reminder", "Hello {client_name},\n\nReminder: {title} is due on {due_date}.\n\n— taxman.manoj"),
    "invoice": ("invoice", "Hello {client_name},\n\nInvoice {invoice_no} for {service_name} ({amount}) is available in your portal.\n\n— taxman.manoj"),
    "payment_receipt": ("payment_receipt", "Hello {client_name},\n\nReceipt for invoice {invoice_no} ({amount}) is available in your portal. Thank you.\n\n— taxman.manoj"),
    "ticket_update": ("ticket_update", "Hello {client_name},\n\nYour ticket \"{subject}\" has been updated. Please check your portal.\n\n— taxman.manoj"),
}


def wa_deep_link(phone: str, template_key: str, **values) -> dict:
    key, template = WA_TEMPLATES.get(template_key, (template_key, "Hello {client_name},\n\n— taxman.manoj"))
    message = template.format(**{**{"client_name": "Client"}, **values})
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "91" + digits
    link = f"https://wa.me/{digits}?text=" + quote(message)
    return {"template": key, "message": message, "link": link, "status": "deep_link_available", "created_at": iso(now())}
