from collections.abc import Generator

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.dao.course_dao import CourseDAO
from app.dao.delete_owned_guide_dao import DeleteOwnedGuideDAO
from app.dao.my_guide_dao import MyGuideDAO
from app.dao.publish_guide_dao import PublishGuideDAO
from app.dao.read_guide_dao import ReadGuideDAO
from app.dao.saved_guide_dao import SavedGuideDAO
from app.dao.update_owned_guide_dao import UpdateOwnedGuideDAO
from app.dao.user_dao import UserDAO
from app.db import SessionLocal
from app.services.auth import AuthenticatedUser, AuthService
from app.services.courses import CourseService
from app.services.my_guides import MyGuidesService
from app.services.publish_guide import PublishGuideService
from app.services.read_guide import ReadGuideService
from app.services.saved_guides import SavedGuidesService


bearer_scheme = HTTPBearer(auto_error=False)


def get_auth_service(request: Request) -> AuthService:
    return request.app.state.auth_service


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    auth_service: AuthService = Depends(get_auth_service),
) -> tuple[str, AuthenticatedUser]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="กรุณาส่ง Bearer token เพื่อยืนยันตัวตน", headers={"WWW-Authenticate": "Bearer"})
    user = auth_service.get_user(credentials.credentials)
    if user is None:
        raise HTTPException(status_code=401, detail="Token ไม่ถูกต้องหรือหมดอายุ", headers={"WWW-Authenticate": "Bearer"})
    return credentials.credentials, user


def get_db_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


def get_my_guides_service(
    session: Session = Depends(get_db_session),
) -> MyGuidesService:
    return MyGuidesService(
        session=session,
        course_dao=CourseDAO(session),
        user_dao=UserDAO(session),
        my_guide_dao=MyGuideDAO(session),
        update_owned_guide_dao=UpdateOwnedGuideDAO(session),
        delete_owned_guide_dao=DeleteOwnedGuideDAO(session),
    )


def get_course_service(
    session: Session = Depends(get_db_session),
) -> CourseService:
    return CourseService(CourseDAO(session))


def get_read_guide_service(
    session: Session = Depends(get_db_session),
) -> ReadGuideService:
    return ReadGuideService(CourseDAO(session), ReadGuideDAO(session))


def get_publish_guide_service(
    session: Session = Depends(get_db_session),
) -> PublishGuideService:
    return PublishGuideService(
        session,
        CourseDAO(session),
        UserDAO(session),
        PublishGuideDAO(session),
    )


def get_saved_guides_service(
    session: Session = Depends(get_db_session),
) -> SavedGuidesService:
    return SavedGuidesService(
        session, SavedGuideDAO(session), ReadGuideDAO(session)
    )
