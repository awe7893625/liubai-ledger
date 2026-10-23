"""Isolated browser UI checks. All API/Auth/data responses are fixtures.
No real account creation, credentials, production queries or database writes.
This is NOT a production end-to-end or native iPhone acceptance test.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64
import json
import time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.qa/shortcut-onboarding-20261022/isolated-ui'
OUT.mkdir(parents=True,exist_ok=True)
UID='11111111-1111-4111-8111-111111111111'
REF='vhosvmnhdrzkhmkmptqg'
NOW='2026-10-22T06:00:00Z'

def enc(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
access=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':UID,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.fixture-not-a-valid-signature'
user={'id':UID,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','app_metadata':{'provider':'email'},'user_metadata':{'display_name':'捷徑引導測試'},'created_at':NOW}
session={'access_token':access,'refresh_token':'fixture-not-a-real-token','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}
checks=[]
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True)
    try:
        for width in (390,1280):
            state={'manual':False,'wallet':False,'review':False,'offline':False,'revoked':False}
            context=browser.new_context(viewport={'width':width,'height':844})
            context.add_init_script('localStorage.setItem('+json.dumps('sb-'+REF+'-auth-token')+','+json.dumps(json.dumps(session))+');')
            def handle(route):
                url=urlparse(route.request.url);path=url.path
                def fulfill(data,status=200,headers=None):
                    route.fulfill(status=status,body=json.dumps(data),headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'http://127.0.0.1:5194','Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})})
                devices=[{'id':'phone-a','name':'測試 iPhone A','created_at':NOW,'last_seen_at':NOW,'revoked_at':NOW if state['revoked'] else None},
                         {'id':'phone-b','name':'測試 iPhone B','created_at':NOW,'last_seen_at':None,'revoked_at':None}]
                if path=='/api/v2/bootstrap':
                    fulfill({'ok':True,'profile':{'user_id':UID,'plan':'free','locale':'zh-TW','timezone':'Asia/Taipei'},'accounts':[{'id':'account','name':'測試付款方式','type':'card','currency':'TWD','issuer':None}],
                             'categories':[{'id':'category','name':'其他','slug':'other'}]});return
                if path=='/api/v2/devices':
                    result={'ok':True,'devices':devices}
                    if parse_qs(url.query).get('onboarding')==['1']:
                        if state['offline']:route.abort();return
                        progress=[]
                        for d in devices:
                            if d['revoked_at']:continue
                            manual=state['manual'] and d['id']=='phone-a'
                            wallet=state['wallet'] and d['id']=='phone-a'
                            progress.append({'device_id':d['id'],'stage':'manual_required' if not manual else 'wallet_setup_ready' if not wallet else 'wallet_received_review' if state['review'] else 'wallet_receipt_received',
                                'manual_receipt':{'received_at':NOW,'transaction_id':'fixture-tx','needs_review':False} if manual else None,
                                'wallet_receipt':{'received_at':NOW,'transaction_id':'fixture-wallet','needs_review':state['review']} if wallet else None,
                                'can_configure_wallet':manual,'ios_trigger_attested':False})
                        result['onboarding']={'version':1,'devices':progress,'checked_at':NOW}
                    fulfill(result);return
                if path=='/api/v2/accounts':fulfill({'ok':True,'accounts':[{'id':'account','name':'測試付款方式','type':'card','currency':'TWD','card_aliases':[]} ]});return
                if path.startswith('/rest/v1/ledger_transactions'):
                    fulfill([],headers={'Content-Range':'0-0/0'});return
                if path.startswith('/auth/v1/user'):fulfill(user);return
                # Do not pass any unknown API/auth/data request to a real server.
                if path.startswith(('/api/','/auth/','/rest/')):fulfill({'error':'Unexpected fixture request'},500);return
                route.continue_()
            context.route('**/*',handle)
            page=context.new_page();errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto('http://127.0.0.1:5194/connect?tab=settings&paired=1',wait_until='networkidle',timeout=60000)
            panel=page.get_by_role('region',name='捷徑與 Apple Pay 設定流程',exact=True)
            panel.wait_for();select=panel.get_by_label('正在設定的裝置',exact=True);select.wait_for();select.select_option('phone-a')
            assert not panel.get_by_role('button',name='完成上一個步驟後繼續',exact=True).is_enabled()
            assert panel.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
            assert panel.get_by_role('link',name='安裝手動記帳',exact=True).count()==1
            checks.append({'name':f'{width}px pair callback alone keeps Wallet guide locked','status':'PASS'})
            state['manual']=True
            panel.get_by_role('button',name='我已送出，檢查結果',exact=True).click()
            panel.get_by_text('手動捷徑入帳已確認',exact=False).wait_for()
            panel.get_by_role('link',name='安裝自動記帳',exact=True).wait_for()
            assert 'shortcuts://' in panel.get_by_role('link',name='開啟手動捷徑',exact=True).get_attribute('href')
            page.evaluate('window.scrollTo(0,0)')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT/f'verified-{width}.png'),full_page=True)
            select.select_option('phone-b')
            assert panel.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
            select.select_option('phone-a')
            panel.get_by_role('link',name='安裝自動記帳',exact=True).wait_for()
            checks.append({'name':f'{width}px verified receipt unlocks only its selected phone','status':'PASS'})
            state['offline']=True
            panel.get_by_role('button',name='更新測試結果',exact=True).click()
            panel.get_by_role('alert').wait_for()
            assert panel.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
            state['offline']=False
            panel.get_by_role('button',name='更新測試結果',exact=True).click()
            panel.get_by_role('link',name='安裝自動記帳',exact=True).wait_for()
            checks.append({'name':f'{width}px stale/error state is locked until refreshed','status':'PASS'})
            state['wallet']=True;state['review']=True
            panel.get_by_role('button',name='更新測試結果',exact=True).click()
            panel.get_by_text('已收到 Wallet 記帳資料，請檢查金額、商家或卡片對應。',exact=True).wait_for()
            state['review']=False
            panel.get_by_role('button',name='更新測試結果',exact=True).click()
            panel.get_by_text('後端已收到 Wallet 交易資料並確認入帳。',exact=True).wait_for()
            state['revoked']=True
            panel.get_by_role('button',name='更新測試結果',exact=True).click()
            page.wait_for_function("document.querySelector('[aria-label=\"正在設定的裝置\"]')?.value === 'phone-b'")
            assert panel.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
            nav=page.locator('.ls-app-bottom-nav' if width<720 else '.ls-app-desktop-nav')
            nav.get_by_role('button',name='首頁',exact=True).click()
            page.get_by_role('region',name='Apple Pay 自動記帳入門',exact=True).wait_for()
            page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden')
            assert page.locator('.ls-load-error').count()==0, 'Fixture ledger count must be complete'
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            page.screenshot(path=str(OUT/f'home-{width}.png'),full_page=True)
            assert not errors,errors
            checks.append({'name':f'{width}px wallet review, revocation and homepage layout pass','status':'PASS'})
            context.close()
    finally:browser.close()
report={'status':'PASS','scope':'isolated_browser_fixtures_no_live_backend','checks':checks,'native_iPhone_tested':False}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False,indent=2))
