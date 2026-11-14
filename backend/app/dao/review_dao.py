from sqlalchemy import delete, select, update

from app.models.guide import Guide
from app.models.review import Review, summary_reference, utc_now
from app.models.user import User


class ReviewDAO:
    def __init__(self, session):
        self.session = session

    @staticmethod
    def target(kind):
        return Guide.__table__ if kind == "guide" else summary_reference

    @staticmethod
    def target_fk(kind):
        return Review.guide_id if kind == "guide" else Review.summary_id

    def lock(self, statement, table):
        if self.session.get_bind().dialect.name == "mssql":
            return statement.with_hint(table, "WITH (UPDLOCK, HOLDLOCK)", "mssql")
        return statement.with_for_update()

    def list_for_target(self, kind, target_id):
        target = self.target(kind)
        stmt = (select(target.c.id, Review, User)
                .select_from(target.outerjoin(Review, self.target_fk(kind) == target.c.id)
                             .outerjoin(User, User.id == Review.author_id))
                .where(target.c.id == target_id)
                .order_by(Review.created_at.desc(), Review.id.desc()))
        return self.session.execute(stmt).all()

    def get_target_for_create(self, kind, target_id):
        target = self.target(kind)
        owner = target.c.publisher_id if kind == "guide" else target.c.owner_id
        stmt = select(target.c.id, owner).where(target.c.id == target_id)
        return self.session.execute(self.lock(stmt, target)).first()

    def create(self, kind, target_id, author_id, rating, comment):
        review = Review(author_id=author_id, rating=rating, comment=comment,
                        **{f"{kind}_id": target_id})
        self.session.add(review)
        self.session.flush()
        return review

    def get_review_for_write(self, review_id):
        stmt = select(Review).where(Review.id == review_id)
        return self.session.scalar(self.lock(stmt, Review.__table__))

    def get_author(self, author_id):
        return self.session.get(User, author_id)

    def update_owned(self, review_id, author_id, rating, comment):
        result = self.session.execute(update(Review).where(
            Review.id == review_id, Review.author_id == author_id
        ).values(rating=rating, comment=comment, updated_at=utc_now()))
        return result.rowcount

    def delete_owned(self, review_id, author_id):
        return self.session.execute(delete(Review).where(
            Review.id == review_id, Review.author_id == author_id
        )).rowcount
