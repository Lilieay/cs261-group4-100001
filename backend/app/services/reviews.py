from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.schemas.reviews import ReviewDTO, ReviewListResponse
from app.services.publisher_name import format_publisher_name


class ReviewError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def duplicate_review(exc):
    # Do not turn unrelated FK/CHECK/unique failures into a duplicate review.
    message = str(exc.orig).lower()
    return any(name in message for name in (
        "ux_reviews_guide_author", "ux_reviews_summary_author",
        "unique constraint failed: reviews.guide_id, reviews.author_id",
        "unique constraint failed: reviews.summary_id, reviews.author_id",
    ))


class ReviewsService:
    def __init__(self, session, dao):
        self.session, self.dao = session, dao

    def execute(self, operation, *, creating=False):
        try:
            result = operation()
            self.session.commit()
            return result
        except Exception as exc:
            try:
                self.session.rollback()
            except SQLAlchemyError as rollback_exc:
                raise ReviewError(503, "STORAGE_UNAVAILABLE", "ไม่ทราบผลบันทึก กรุณาโหลดข้อมูลล่าสุดก่อนลองใหม่") from rollback_exc
            if creating and isinstance(exc, IntegrityError) and duplicate_review(exc):
                raise ReviewError(409, "REVIEW_ALREADY_EXISTS", "คุณมีรีวิวในผลงานนี้แล้ว") from exc
            if isinstance(exc, SQLAlchemyError):
                raise ReviewError(503, "STORAGE_UNAVAILABLE", "ไม่สามารถอ่านหรือบันทึกรีวิวได้ กรุณาโหลดข้อมูลล่าสุด") from exc
            raise

    @staticmethod
    def dto(review, author):
        kind = "guide" if review.guide_id is not None else "summary"
        return ReviewDTO(
            id=review.id, target_type=kind, target_id=getattr(review, f"{kind}_id"),
            rating=review.rating, comment=review.comment,
            author={"id": author.id, "display_name": format_publisher_name(author)},
            created_at=review.created_at, updated_at=review.updated_at,
        )

    def list_for_target(self, kind, target_id):
        def operation():
            rows = self.dao.list_for_target(kind, target_id)
            if not rows:
                raise ReviewError(404, f"{kind.upper()}_NOT_FOUND", "ไม่พบผลงาน")
            return ReviewListResponse(target_type=kind, target_id=target_id,
                                      items=[self.dto(r, u) for _, r, u in rows if r is not None])
        return self.execute(operation)

    def create(self, kind, target_id, user_id, payload):
        def operation():
            target = self.dao.get_target_for_create(kind, target_id)
            if target is None:
                raise ReviewError(404, f"{kind.upper()}_NOT_FOUND", "ไม่พบผลงาน")
            if target[1] == user_id:
                raise ReviewError(403, "SELF_REVIEW_FORBIDDEN", "รีวิวผลงานของตนเองไม่ได้")
            review = self.dao.create(kind, target_id, user_id, payload.rating, payload.comment)
            return self.dto(review, self.dao.get_author(user_id))
        return self.execute(operation, creating=True)

    def write(self, review_id, user_id, payload=None):
        def operation():
            review = self.dao.get_review_for_write(review_id)
            if review is None:
                raise ReviewError(404, "REVIEW_NOT_FOUND", "ไม่พบรีวิว")
            if review.author_id != user_id:
                raise ReviewError(403, "REVIEW_FORBIDDEN", "จัดการได้เฉพาะรีวิวของตนเอง")
            if payload is None:
                count = self.dao.delete_owned(review_id, user_id)
                result = None
            else:
                count = self.dao.update_owned(review_id, user_id, payload.rating, payload.comment)
                if count != 1:
                    raise ReviewError(404, "REVIEW_NOT_FOUND", "ไม่พบรีวิว")
                self.session.refresh(review)
                result = self.dto(review, self.dao.get_author(user_id))
            if count != 1:
                raise ReviewError(404, "REVIEW_NOT_FOUND", "ไม่พบรีวิว")
            return result
        return self.execute(operation)
