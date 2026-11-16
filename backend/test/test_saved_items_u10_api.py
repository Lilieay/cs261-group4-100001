"""U10 API: real SQLite/DAO/service; auth is the shared fixture's test double."""
from unittest.mock import patch

import pytest
from sqlalchemy import delete, event
from sqlalchemy.exc import SQLAlchemyError

from test_saved_items_api import saved_item_client
from app.dao.saved_guide_dao import SavedGuideDAO
from app.dao.saved_items_dao import SavedSummaryDAO
from app.models.course import Course
from app.models.guide import Guide
from app.models.saved_guide import SavedGuide
from app.models.saved_summary import SavedSummary
from app.models.summary import Summary, SummaryFile


def assert_error(response, status, code):
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert isinstance(response.json()["error"]["fields"], list)
    assert response.headers["cache-control"] == "no-store"


def test_empty_list_and_user_isolation(saved_item_client):
    client, _, _, ids, account = saved_item_client
    response = client.get('/api/saved-items')
    assert response.status_code == 200
    assert response.json() == {"items": []}
    assert response.headers['cache-control'] == 'no-store'
    account['id'] = ids['user_b']
    items = client.get('/api/saved-items').json()['items']
    assert len(items) == 1 and items[0]['item_id'] == ids['guide']
    assert items[0]['item_type'] == 'guide'


def test_list_groups_by_course_keeps_each_target_and_uses_current_metadata(saved_item_client):
    client, sessions, _, ids, _ = saved_item_client
    with sessions.begin() as session:
        session.add(Course(id=99, course_code='CS104', course_name='Programming'))
        second = Summary(id=100, course_id=99, owner_id=ids['user_b'], title='Other course')
        third = Summary(id=101, course_id=ids['course'], owner_id=ids['user_a'], title='Second PDF')
        session.add_all([second, third])
        session.flush()
        for target in (second, third):
            session.add(SummaryFile(summary_id=target.id, storage_key=f'{target.id:032x}',
                                   original_name='sample.pdf', content_type='application/pdf', size_bytes=10))
    for kind, target_id in [('guide', ids['guide']), ('summary', ids['summary']),
                            ('summary', 100), ('summary', 101)]:
        assert client.put(f'/api/saved-items/{kind}/{target_id}').status_code == 200
    with sessions.begin() as session:
        session.get(Guide, ids['guide']).title = 'ชื่อแนวข้อสอบล่าสุด'
    items = client.get('/api/saved-items').json()['items']
    assert [(i['course']['course_code'], i['item_type'], i['item_id']) for i in items] == [
        ('CS104', 'summary', 100), ('CS261', 'guide', ids['guide']),
        ('CS261', 'summary', 101), ('CS261', 'summary', ids['summary'])]
    for item in items:
        assert set(item) == {'item_type', 'item_id', 'course', 'title', 'open_path'}
        collection = 'guides' if item['item_type'] == 'guide' else 'summaries'
        assert item['open_path'] == f"/api/{collection}/{item['item_id']}"
    assert items[1]['title'] == 'ชื่อแนวข้อสอบล่าสุด'
    # Another HTTP/session read returns the same persisted list.
    assert client.get('/api/saved-items').json()['items'] == items


@pytest.mark.parametrize('kind', ['guide', 'summary'])
def test_remove_is_repeatable_and_preserves_other_users_and_targets(saved_item_client, kind):
    client, sessions, _, ids, account = saved_item_client
    target_id = ids[kind]
    path = f'/api/saved-items/{kind}/{target_id}'
    other_kind = 'summary' if kind == 'guide' else 'guide'
    assert client.put(path).status_code == 200
    assert client.put(f'/api/saved-items/{other_kind}/{ids[other_kind]}').status_code == 200
    account['id'] = ids['user_b']
    assert client.put(path).status_code == 200
    account['id'] = ids['user_a']
    for _ in range(2):
        result = client.delete(path)
        assert result.status_code == 200
        assert result.headers['cache-control'] == 'no-store'
        assert result.json() == {'item_type': kind, 'item_id': target_id, 'saved': False}
    remaining = client.get('/api/saved-items').json()['items']
    assert [(i['item_type'], i['item_id']) for i in remaining] == [(other_kind, ids[other_kind])]
    assert client.get(path).json()['saved'] is False
    account['id'] = ids['user_b']
    assert client.get(path).json()['saved'] is True
    with sessions() as session:
        assert session.get(Guide, ids['guide']) is not None
        assert session.get(Summary, ids['summary']) is not None
        file = session.get(SummaryFile, ids['summary'])
        assert file.storage_key == 'test-summary-private-key' and file.size_bytes == 10
        assert session.get(Course, ids['course']) is not None


@pytest.mark.parametrize('kind', ['guide', 'summary'])
def test_removed_or_missing_target_is_a_successful_noop(saved_item_client, kind):
    client, sessions, _, ids, _ = saved_item_client
    target_id = ids[kind]
    client.put(f'/api/saved-items/{kind}/{target_id}')
    model = Guide if kind == 'guide' else Summary
    with sessions.begin() as session:
        session.execute(delete(model).where(model.id == target_id))
    assert client.get('/api/saved-items').json() == {'items': []}
    for value in [target_id, 999999]:
        response = client.delete(f'/api/saved-items/{kind}/{value}')
        assert response.status_code == 200
        assert response.json()['saved'] is False


@pytest.mark.parametrize('kind', ['guide', 'summary'])
@pytest.mark.parametrize('value', ['0', '-1', '1.0', '+1', '1e1', 'true', 'x', '2147483648'])
def test_remove_rejects_invalid_id(saved_item_client, kind, value):
    client, _, _, _, _ = saved_item_client
    assert_error(client.delete(f'/api/saved-items/{kind}/{value}'), 422, 'INVALID_PARAMETERS')


@pytest.mark.parametrize('method,path,kwargs', [
    ('GET', '/api/saved-items?user_id=2', {}),
    ('GET', '/api/saved-items', {'content': '{}'}),
    ('DELETE', '/api/saved-items/course/1', {}),
    ('DELETE', '/api/saved-items/guide/1?user_id=2', {}),
    ('DELETE', '/api/saved-items/guide/1', {'json': {'user_id': 2}}),
])
def test_rejects_body_query_and_wrong_type(saved_item_client, method, path, kwargs):
    client, _, _, _, _ = saved_item_client
    assert_error(client.request(method, path, **kwargs), 422, 'INVALID_PARAMETERS')


@pytest.mark.parametrize('method,path', [('GET', '/api/saved-items'),
                                         ('DELETE', '/api/saved-items/guide/1'),
                                         ('DELETE', '/api/saved-items/summary/1')])
def test_requires_authentication(saved_item_client, method, path):
    from app.main import app
    from app.dependencies import current_user, get_auth_service
    from types import SimpleNamespace
    client, _, _, _, _ = saved_item_client
    previous = app.dependency_overrides.pop(current_user)
    app.dependency_overrides[get_auth_service] = lambda: SimpleNamespace(get_user=lambda _: None)
    try:
        for headers in ({}, {'Authorization': 'Bearer expired'}):
            response = client.request(method, path, headers=headers)
            assert_error(response, 401, 'AUTH_REQUIRED')
            assert response.headers['www-authenticate'] == 'Bearer'
    finally:
        app.dependency_overrides[current_user] = previous
        app.dependency_overrides.pop(get_auth_service, None)


@pytest.mark.parametrize('dao', [SavedGuideDAO, SavedSummaryDAO])
def test_list_failure_does_not_return_a_partial_list(saved_item_client, dao):
    client, _, _, ids, _ = saved_item_client
    client.put(f"/api/saved-items/guide/{ids['guide']}")
    with patch.object(dao, 'list_by_user', side_effect=SQLAlchemyError('injected read failure')):
        assert_error(client.get('/api/saved-items'), 503, 'SAVED_ITEMS_UNAVAILABLE')
    assert len(client.get('/api/saved-items').json()['items']) == 1


@pytest.mark.parametrize('kind,dao', [('guide', SavedGuideDAO), ('summary', SavedSummaryDAO)])
def test_failed_remove_rolls_back_real_delete(saved_item_client, kind, dao):
    client, _, _, ids, _ = saved_item_client
    path = f'/api/saved-items/{kind}/{ids[kind]}'
    client.put(path)
    original = dao.remove
    def delete_then_fail(self, *args):
        original(self, *args)
        raise SQLAlchemyError('injected failure after DELETE')
    with patch.object(dao, 'remove', delete_then_fail):
        assert_error(client.delete(path), 503, 'SAVED_ITEMS_UNAVAILABLE')
    assert client.get(path).json()['saved'] is True


def test_failed_remove_commit_preserves_bookmark(saved_item_client):
    client, sessions, _, ids, _ = saved_item_client
    path = f"/api/saved-items/summary/{ids['summary']}"
    client.put(path)
    @event.listens_for(sessions, 'before_commit', once=True)
    def fail_commit(_session):
        raise SQLAlchemyError('injected before commit')
    assert_error(client.delete(path), 503, 'SAVED_ITEMS_UNAVAILABLE')
    assert client.get(path).json()['saved'] is True
