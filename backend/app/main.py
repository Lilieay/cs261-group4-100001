from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.config import PDF_REQUEST_MAX_BYTES, PDF_STORAGE_ROOT
from app.db import SessionLocal
from app.routers.auth import router as auth_router
from app.routers.courses import router as courses_router
from app.routers.guides import router as guides_router
from app.routers.my_guide_deletions import router as my_guide_deletions_router
from app.routers.my_guide_updates import router as my_guide_updates_router
from app.routers.my_guides import router as my_guides_router
from app.routers.my_summaries import router as my_summaries_router
from app.routers.saved_guides import router as saved_guides_router
from app.routers.saved_items import router as saved_items_router
from app.routers.saved_items import saved_items_http_error
from app.routers.reviews import router as reviews_router
from app.routers.reviews import reviews_http_exception_handler
from app.routers.summaries import router as summaries_router
from app.middleware.pdf_upload_limit import PdfUploadSizeLimitMiddleware
from app.middleware.summary_no_store import SummaryNoStoreMiddleware
from app.middleware.saved_items_no_store import SavedItemsNoStoreMiddleware
from app.services.auth import AuthService
from app.services.summary_storage import LocalPdfStorage
from app.services.tu_api import verify_tu_account

@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.pdf_storage.retry_pending_cleanup()
    yield


app = FastAPI(lifespan=lifespan)


@app.exception_handler(StarletteHTTPException)
async def api_http_exception_handler(request, error):
    saved_items_error = saved_items_http_error(request, error)
    if saved_items_error is not None:
        return saved_items_error
    return await reviews_http_exception_handler(request, error)


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
app.include_router(saved_items_router)
app.include_router(reviews_router)
app.include_router(summaries_router)
app.include_router(my_summaries_router)


app.add_middleware(
    PdfUploadSizeLimitMiddleware,
    max_bytes=PDF_REQUEST_MAX_BYTES,
)
app.add_middleware(SummaryNoStoreMiddleware)
app.add_middleware(SavedItemsNoStoreMiddleware)


@app.get("/")
def root():
    return {"message": "Backend is running"}
