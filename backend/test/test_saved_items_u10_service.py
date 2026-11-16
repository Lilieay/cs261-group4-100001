from types import SimpleNamespace

import pytest
from sqlalchemy.exc import SQLAlchemyError

from test_saved_items_service import make_service
from app.services.saved_items import SavedItemsUnavailable


def target(identifier, code):
    return SimpleNamespace(id=identifier, title=f'Item {identifier}',
                           course=SimpleNamespace(id=1, course_code=code, course_name=code))


def test_list_dispatch_sort_and_exact_identity():
    service, guide, events = make_service()
    summary = service.daos['summary']
    guide.list_by_user.return_value = [target(2, 'CS261'), target(3, 'CS104')]
    summary.list_by_user.return_value = [target(2, 'CS261'), target(9, 'CS261')]
    result = service.list_for_user(7)
    assert [(i.course.course_code, i.item_type, i.item_id) for i in result.items] == [
        ('CS104', 'guide', 3), ('CS261', 'guide', 2), ('CS261', 'summary', 9), ('CS261', 'summary', 2)]
    guide.list_by_user.assert_called_once_with(7)
    summary.list_by_user.assert_called_once_with(7)
    assert events == ['begin', 'commit']


@pytest.mark.parametrize('kind', ['guide', 'summary'])
@pytest.mark.parametrize('rowcount', [0, 1])
def test_remove_zero_or_one_row_is_success_and_never_checks_target(kind, rowcount):
    service, _, events = make_service()
    dao = service.daos[kind]
    dao.remove.return_value = rowcount
    assert service.remove(7, kind, 12).model_dump() == {'item_type': kind, 'item_id': 12, 'saved': False}
    dao.remove.assert_called_once_with(7, 12)
    dao.target_exists.assert_not_called()
    assert events == ['begin', 'commit']


@pytest.mark.parametrize('kind', ['guide', 'summary'])
def test_remove_storage_error_rolls_back(kind):
    service, _, events = make_service()
    service.daos[kind].remove.side_effect = SQLAlchemyError('failure')
    with pytest.raises(SavedItemsUnavailable):
        service.remove(7, kind, 12)
    assert 'rollback' in events and 'commit' not in events


def test_list_error_is_not_an_empty_or_partial_success():
    service, guide, events = make_service()
    guide.list_by_user.return_value = [target(2, 'CS261')]
    service.daos['summary'].list_by_user.side_effect = SQLAlchemyError('failure')
    with pytest.raises(SavedItemsUnavailable):
        service.list_for_user(7)
    assert 'rollback' in events and 'commit' not in events
