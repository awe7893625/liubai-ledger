"""Validate public Shortcut bindings and the API contract, not a replacement for iOS execution."""
import importlib.util
import json
import plistlib
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('public_shortcuts', ROOT/'scripts/build_public_shortcuts.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

URL = 'https://synthetic-ledger.example.invalid/api/wallet'
TOKEN = 'synthetic-test-token-not-real'
INPUT = {'amount': 120, 'merchant': '示範咖啡店', 'card': '我的日常卡'}

def resolve_request(data, *, remove_comments=False):
    outputs = {}
    requests = []
    def value(v):
        if isinstance(v, dict):
            typ = v.get('WFSerializationType')
            if typ == 'WFTextTokenAttachment':
                ref = v['Value']
                return INPUT if ref['Type'] == 'ExtensionInput' else outputs[ref['OutputUUID']]
            if typ == 'WFTextTokenString':
                text = v['Value']['string']
                attachments = v['Value'].get('attachmentsByRange', {})
                if attachments:
                    assert text == chr(0xFFFC)
                    assert list(attachments) == ['{0, 1}']
                    ref = attachments['{0, 1}']
                    assert ref['Type'] == 'ActionOutput'
                    return str(outputs[ref['OutputUUID']])
                return text
            if typ == 'WFDictionaryFieldValue':
                return {value(item['WFKey']):value(item['WFValue']) for item in v['Value']['WFDictionaryFieldValueItems']}
        return v
    for action in data['WFWorkflowActions']:
        kind = action['WFWorkflowActionIdentifier'].rsplit('.', 1)[1]
        params = action['WFWorkflowActionParameters']
        uid = params['UUID']
        if kind == 'comment':
            if not remove_comments:outputs[uid] = None
        elif kind == 'gettext':
            raw = params['WFTextActionText']
            outputs[uid] = URL if raw == builder.PLACEHOLDER_URL else TOKEN if raw == builder.PLACEHOLDER_TOKEN else value(raw)
        elif kind == 'getvalueforkey':
            assert params['WFGetDictionaryValueType'] == 'Value'
            outputs[uid] = value(params['WFInput'])[params['WFDictionaryKey']]
        elif kind == 'ask':
            for field in INPUT:
                if uid == builder.ident('manual-'+field):outputs[uid] = INPUT[field];break
            else:raise AssertionError('Unknown prompt binding')
        elif kind == 'url':outputs[uid] = value(params['WFURLActionURL'])
        elif kind == 'downloadurl':
            requests.append({'url':value(params['WFInput']), 'method':params['WFHTTPMethod'],
                             'headers':value(params['WFHTTPHeaders']), 'body':value(params['WFJSONValues'])})
            outputs[uid] = '{"ok":true,"tx_id":"synthetic"}'
        elif kind == 'notification':assert value(params['WFNotificationActionBody']) == outputs[builder.ident(('wallet' if data['WFWorkflowName'].endswith('Wallet') else 'manual')+'-response')]
        else:raise AssertionError(kind)
    assert len(requests) == 1
    return requests[0]

@pytest.mark.parametrize('mode',['wallet','manual'])
def test_configuration_questions_bind_to_actual_text_actions(mode):
    data=builder.build(mode);builder.validate(data)
    actions=data['WFWorkflowActions']
    expected=[builder.PLACEHOLDER_URL,builder.PLACEHOLDER_TOKEN]
    assert len(data['WFWorkflowImportQuestions'])==2
    for question, default in zip(data['WFWorkflowImportQuestions'],expected):
        action=actions[question['ActionIndex']]
        assert action['WFWorkflowActionIdentifier']=='is.workflow.actions.gettext'
        assert action['WFWorkflowActionParameters'][question['ParameterKey']]==default
    source=plistlib.loads((ROOT/'shortcuts/src'/f'Ledger-{mode.title()}.plist').read_bytes())
    assert data==source

@pytest.mark.parametrize('mode',['wallet','manual'])
def test_comments_are_not_required_or_transmitted(mode):
    data=builder.build(mode)
    with_comments=resolve_request(data)
    without_comments=resolve_request(data,remove_comments=True)
    assert with_comments==without_comments
    assert '說明' not in json.dumps(with_comments,ensure_ascii=False)
    assert TOKEN not in json.dumps(with_comments['body'])

@pytest.mark.parametrize('mode',['wallet','manual'])
def test_post_and_dictionary_values_keep_correct_types(mode):
    request=resolve_request(builder.build(mode))
    assert request['url']==URL and TOKEN not in request['url']
    assert request['method']=='POST'
    assert request['headers']=={'X-Ledger-Token':TOKEN,'Content-Type':'application/json'}
    assert request['body']['amount']=='120'
    assert request['body']['merchant']=='示範咖啡店'
    assert request['body']['card']=='我的日常卡'
    assert set(request['body'])=={'amount','merchant','card','payment_method','time_source'}

@pytest.mark.parametrize('mode',['wallet','manual'])
def test_generated_request_accepted_by_isolated_backend(mode,tmp_path,monkeypatch):
    monkeypatch.setenv('DATABASE_URL','sqlite:///'+str(tmp_path/'onboarding.db'))
    monkeypatch.setenv('LEDGER_INGEST_TOKEN',TOKEN)
    from app.db import reset_conn,q
    from app.main import create_app
    from fastapi.testclient import TestClient
    reset_conn()
    request=resolve_request(builder.build(mode))
    try:
        with TestClient(create_app()) as client:
            assert client.post('/api/wallet',json=request['body']).status_code==401
            response=client.post('/api/wallet',json=request['body'],headers=request['headers'])
            assert response.status_code==201,response.text
            assert response.json()['ok'] is True
            row=q('SELECT amount,merchant,notes FROM transactions WHERE id=?',response.json()['tx_id'])[0]
            assert row['amount']==-12000 and row['merchant']=='示範咖啡店'
            assert TOKEN not in (row['notes'] or '')
    finally:reset_conn()

def test_brand_and_threads_in_current_sources():
    site=(ROOT/'frontend/src/public-site/PublicSite.tsx').read_text()
    guide=(ROOT/'frontend/src/public-site/ShortcutFieldGuide.tsx').read_text()
    assert '留白工作室' in site and 'threads.net/@blankspacestw' in site
    assert 'ShortcutFieldGuide' in site
    assert '改內容，不刪動作' in guide and 'POST' in guide and 'Value' in guide
    for path in [ROOT/'README.md',ROOT/'LICENSE',ROOT/'frontend/index.html']:
        assert '留百' not in path.read_text()
