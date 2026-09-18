# taxman.manoj — Tax & Compliance Client Portal backend.
import logging

from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core import COLL, db
from routers import admin_api, auth, client_api
from seed import seed_if_empty

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("taxman")

app = FastAPI(title="taxman.manoj API", version="1.0.0")
app.include_router(auth.router)
app.include_router(client_api.router)
app.include_router(admin_api.router)


@app.exception_handler(InvalidId)
async def invalid_id_handler(request: Request, exc: InvalidId):
    # Malformed ObjectId in a path/param -> clean 404 instead of a 500.
    return JSONResponse(status_code=404, content={"detail": "Resource not found"})

app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def secure_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith(("/api/documents", "/api/files")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db[COLL["requests"]].create_index([("client_id", 1), ("created_at", -1)])
    await db[COLL["documents"]].create_index([("client_id", 1), ("created_at", -1)])
    await db[COLL["documents"]].create_index("request_id")
    await db[COLL["payments"]].create_index([("client_id", 1), ("created_at", -1)])
    await db[COLL["invoices"]].create_index([("client_id", 1), ("created_at", -1)])
    await db[COLL["invoices"]].create_index("number")
    await db[COLL["notifications"]].create_index([("user_id", 1), ("read", 1)])
    await db[COLL["access_logs"]].create_index("document_id")
    await db[COLL["audit"]].create_index("created_at")
    await db[COLL["otps"]].create_index("email")
    await db[COLL["businesses"]].create_index("client_id")
    await db[COLL["tickets"]].create_index("client_id")
    await db[COLL["ticket_messages"]].create_index("ticket_id")
    await seed_if_empty()
    await db[COLL["client_prices"]].create_index([("client_id", 1), ("service_id", 1), ("fy", 1), ("ay", 1)])
    await db[COLL["recurring"]].create_index("next_due")
    await db[COLL["deadlines"]].create_index("due_date")
    # Lazy scheduler: run recurring service generation + deadline reminders on boot.
    try:
        from routers.admin_api import run_recurring, run_deadline_reminders
        created = await run_recurring()
        sent = await run_deadline_reminders()
        logger.info("scheduler: %s recurring created, %s reminders sent", created, sent)
    except Exception as e:  # never block startup
        logger.warning("scheduler run skipped: %s", e)
    logger.info("taxman.manoj backend ready")


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "taxman.manoj", "brand": "taxman.manoj — Your Compliance. Simplified."}
