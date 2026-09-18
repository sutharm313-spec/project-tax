# Branded PDF invoice / receipt generation for taxman.manoj.
import io

from reportlab.lib import colors as rc
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

NAVY = rc.HexColor("#0B1F3A")
BLUE = rc.HexColor("#3B82F6")
GREY = rc.HexColor("#64748B")
LIGHT = rc.HexColor("#E2E8F0")


def _money(n) -> str:
    try:
        return f"Rs. {int(n):,}"
    except Exception:
        return f"Rs. {n}"


def build_invoice_pdf(invoice: dict, client: dict, business: dict | None, settings: dict, paid: bool, payment: dict | None) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    W, H = A4
    biz = (settings or {}).get("business", {})
    biz_name = biz.get("name") or "taxman.manoj"

    # Header band
    c.setFillColor(NAVY)
    c.rect(0, H - 40 * mm, W, 40 * mm, fill=1, stroke=0)
    c.setFillColor(rc.white)
    c.setFont("Helvetica-Bold", 22)
    c.drawString(20 * mm, H - 20 * mm, "taxman.manoj")
    c.setFillColor(BLUE)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, H - 26 * mm, "Your Compliance. Simplified.")
    c.setFillColor(rc.white)
    c.setFont("Helvetica-Bold", 16)
    label = "RECEIPT" if paid else "INVOICE"
    c.drawRightString(W - 20 * mm, H - 20 * mm, label)
    c.setFont("Helvetica", 10)
    c.drawRightString(W - 20 * mm, H - 26 * mm, invoice.get("number", ""))

    y = H - 52 * mm
    # Business + client blocks
    c.setFillColor(GREY)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(20 * mm, y, "FROM")
    c.drawString(115 * mm, y, "BILLED TO")
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(20 * mm, y - 6 * mm, biz_name)
    c.drawString(115 * mm, y - 6 * mm, client.get("name", ""))
    c.setFont("Helvetica", 9)
    c.setFillColor(GREY)
    fl = [biz.get("legal_name", ""), biz.get("email", ""), biz.get("phone", ""), biz.get("address", "")]
    cl = [client.get("client_code", ""), client.get("email", ""), client.get("mobile", ""),
          (business or {}).get("name", ""), ("GSTIN: " + (business or {}).get("gstin", "")) if (business or {}).get("gstin") else ""]
    yy = y - 12 * mm
    for line in [x for x in fl if x]:
        c.drawString(20 * mm, yy, str(line)[:55]); yy -= 5 * mm
    yy2 = y - 12 * mm
    for line in [x for x in cl if x]:
        c.drawString(115 * mm, yy2, str(line)[:55]); yy2 -= 5 * mm

    # Meta
    ty = min(yy, yy2) - 6 * mm
    c.setFillColor(GREY)
    c.setFont("Helvetica", 9)
    date = str(invoice.get("date") or invoice.get("created_at") or "")[:10]
    c.drawString(20 * mm, ty, f"Date: {date}")
    c.drawString(75 * mm, ty, f"Status: {'PAID' if paid else invoice.get('status', 'unpaid').upper()}")
    if payment and payment.get("utr"):
        c.drawString(120 * mm, ty, f"UPI Ref: {payment.get('utr')}")

    # Table header
    ty -= 10 * mm
    c.setFillColor(NAVY)
    c.rect(20 * mm, ty - 2 * mm, W - 40 * mm, 9 * mm, fill=1, stroke=0)
    c.setFillColor(rc.white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(24 * mm, ty + 0.5 * mm, "Description")
    c.drawRightString(W - 24 * mm, ty + 0.5 * mm, "Amount")

    # Row
    ty -= 12 * mm
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(24 * mm, ty, invoice.get("service_name", "Service"))
    c.setFont("Helvetica", 9)
    c.setFillColor(GREY)
    c.drawString(24 * mm, ty - 5 * mm, str(invoice.get("description", ""))[:70])
    c.setFillColor(NAVY)
    c.setFont("Helvetica", 11)
    c.drawRightString(W - 24 * mm, ty, _money(invoice.get("amount", invoice.get("total", 0))))

    # Totals
    ty -= 16 * mm
    c.setStrokeColor(LIGHT)
    c.line(115 * mm, ty + 6 * mm, W - 20 * mm, ty + 6 * mm)
    c.setFillColor(GREY); c.setFont("Helvetica", 10)
    c.drawString(115 * mm, ty, "Subtotal")
    c.drawRightString(W - 24 * mm, ty, _money(invoice.get("amount", invoice.get("total", 0))))
    c.drawString(115 * mm, ty - 6 * mm, "Tax")
    c.drawRightString(W - 24 * mm, ty - 6 * mm, _money(invoice.get("tax", 0)))
    c.setFillColor(NAVY); c.setFont("Helvetica-Bold", 13)
    c.drawString(115 * mm, ty - 15 * mm, "Total")
    c.drawRightString(W - 24 * mm, ty - 15 * mm, _money(invoice.get("total", 0)))

    if paid:
        c.saveState()
        c.setFillColor(rc.HexColor("#10B981"))
        c.setFont("Helvetica-Bold", 40)
        c.translate(60 * mm, 90 * mm)
        c.rotate(18)
        c.setFillAlpha(0.14)
        c.drawString(0, 0, "PAID")
        c.restoreState()

    # Footer
    c.setFillColor(GREY); c.setFont("Helvetica", 8)
    c.drawString(20 * mm, 22 * mm, "This is a computer-generated document from taxman.manoj.")
    c.drawString(20 * mm, 18 * mm, "For queries raise a support ticket in your taxman.manoj portal.")
    if biz.get("upi", {}).get("vpa") or (settings or {}).get("upi", {}).get("vpa"):
        vpa = (settings or {}).get("upi", {}).get("vpa", "")
        if vpa and not paid:
            c.drawString(20 * mm, 14 * mm, f"Pay via UPI: {vpa}")

    c.showPage()
    c.save()
    return buf.getvalue()
