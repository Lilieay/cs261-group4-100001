from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import PDF_REQUEST_MAX_BYTES, PDF_STORAGE_ROOT
from app.db import SessionLocal
from app.routers.auth import router as auth_router
from app.routers.courses import router as courses_router
from app.routers.guides import router as guides_router
from app.routers.my_guide_deletions import router as my_guide_deletions_router
from app.routers.my_guide_updates import router as my_guide_updates_router
from app.routers.my_guides import router as my_guides_router
from app.routers.saved_guides import router as saved_guides_router
from app.routers.summaries import router as summaries_router
from app.middleware.pdf_upload_limit import PdfUploadSizeLimitMiddleware
from app.middleware.summary_no_store import SummaryNoStoreMiddleware
from app.services.auth import AuthService
from app.services.summary_storage import LocalPdfStorage
from app.services.tu_api import verify_tu_account

@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.pdf_storage.retry_pending_cleanup()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5000", "http://localhost:5000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.state.auth_service = AuthService(SessionLocal, verify_tu_account)
app.state.pdf_storage = LocalPdfStorage(PDF_STORAGE_ROOT)
app.include_router(auth_router)
app.include_router(courses_router)
app.include_router(guides_router)
app.include_router(my_guide_deletions_router)
app.include_router(my_guide_updates_router)
app.include_router(my_guides_router)
app.include_router(saved_guides_router)
app.include_router(summaries_router)


app.add_middleware(
    PdfUploadSizeLimitMiddleware,
    max_bytes=PDF_REQUEST_MAX_BYTES,
)
app.add_middleware(SummaryNoStoreMiddleware)


@app.get("/")
def root():
    return {"message": "Backend is running"}
