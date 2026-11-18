from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session, sessionmaker

from app import init_db
from app.models.review import Review


@pytest.mark.parametrize("existing_shared_schema", [False, True])
def test_startup_creates_reviews_and_preserves_them_on_restart(tmp_path, existing_shared_schema):
    engine = create_engine("sqlite://")
    try:
        if existing_shared_schema:
            init_db.Base.metadata.create_all(engine)
        with (
            patch.object(init_db, "engine", engine),
            patch.object(init_db, "SessionLocal", sessionmaker(bind=engine)),
            patch.object(init_db, "_ensure_database"),
            patch.object(init_db, "PDF_STORAGE_ROOT", tmp_path),
            patch.object(init_db.CourseSeedService, "seed", return_value=SimpleNamespace(inserted=[], reused=[])),
            patch.object(init_db.GuideSeedService, "seed"),
            patch.dict("os.environ", {"PDF_SCAN_ORPHANS_ON_STARTUP": "0"}),
        ):
            init_db.main()
            assert inspect(engine).has_table("reviews")
            with Session(engine) as session:
                session.add(Review(id=1, author_id=1, guide_id=1, rating=4, comment="Keep on restart"))
                session.commit()
            init_db.main()
            with Session(engine) as session:
                review = session.scalar(select(Review))
                assert review.rating == 4
                assert review.comment == "Keep on restart"
    finally:
        engine.dispose()
