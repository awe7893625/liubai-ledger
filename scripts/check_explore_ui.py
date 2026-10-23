"""Isolated browser tests for ledger exploration; all Auth/API requests mocked.
No real data, no external map tiles, no production writes. Tests browser behavior,
not a physical iPhone and not hosted persistence.
"""
from pathlib import Path
from urllib.parse import urlparse
import base64,json,time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.qa/explore-release/browser';OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5206';NOW='2026-10-22T08:00:00Z';UID='11111111-1111-4111-8111-111111111111'
def encode(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
user={'id':UID,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','app_metadata':{'provider':'email'},'user_metadata':{'display_name':'探索驗收'},'created_at':NOW}
session={'access_token':encode({'alg':'HS256'})+'.'+encode({'sub':UID,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.invalid-fixture', 'refresh_token':'fixture','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}
rows=[{'id':'tx1','amount_minor':-12000,'currency':'TWD','merchant':'測試咖啡店','status':'confirmed','occurred_at':NOW,'source':'manual','account_id':'a','category_id':'food','note':'🗺️25.033,121.565 · 📍測試地點','updated_at':NOW},
      {'id':'tx2','amount_minor':-30000,'currency':'TWD','merchant':'測試餐廳','status':'confirmed','occurred_at':NOW,'source':'manual','account_id':'a','category_id':'food','note':None,'updated_at':NOW},
      {'id':'tx3','amount_minor':5000,'currency':'TWD','merchant':'測試退款','legacy_kind':'refund','status':'confirmed','occurred_at':NOW,'source':'statement','account_id':'a','category_id':'food','note':None,'updated_at':NOW},
      {'id':'tx4','amount_minor':-99900,'currency':'USD','merchant':'外幣不可混算','status':'confirmed','occurred_at':NOW,'source':'manual','account_id':'usd','category_id':'food','note':None,'updated_at':NOW}]
accounts=[{'id':'a','name':'玉山日常卡','type':'card','currency':'TWD','issuer':None},{'id':'usd','name':'美金卡','type':'card','currency':'USD','issuer':None}]
cats=[{'id':'food','name':'餐飲','slug':'food'}];checks=[];failure=None
with sync_playwright() as pw:
 for engine,width in [('chromium',390),('chromium',1280),('webkit',390)]:
  browser=None
  try:
   browser=getattr(pw,engine).launch(headless=True);context=browser.new_context(viewport={'width':width,'height':844})
   context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+');')
   state={'tiles':0,'writes':0,'unexpected':[],'active':True}
   def route_request(route):
    url=urlparse(route.request.url);path=url.path
    def respond(body,status=200,headers=None):route.fulfill(status=status,body=json.dumps(body),headers={'Content-Type':'application/json','Access-Control-Allow-Origin':BASE,'Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})})
    if route.request.method=='OPTIONS':respond({});return
    if url.hostname=='tile.openstreetmap.org':
     state['tiles']+=1
     # Deterministic tiny tile fixture; no internet request to OSM from tests.
     png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZJkAAAAASUVORK5CYII=')
     route.fulfill(status=200,content_type='image/png',body=png);return
    if path=='/api/v2/bootstrap':respond({'ok':True,'profile':{'user_id':UID,'locale':'zh-TW','timezone':'Asia/Taipei','plan':'free'},'accounts':accounts,'categories':cats});return
    if path=='/api/v2/devices':respond({'ok':True,'devices':[],'onboarding':{'version':1,'devices':[],'checked_at':NOW}});return
    if path.startswith('/api/v2/budgets'):respond({'ok':True,'budget':None});return
    if path=='/api/v2/accounts':respond({'ok':True,'accounts':accounts});return
    if path.startswith('/rest/v1/ledger_transactions'):respond(rows,headers={'Content-Range':f'0-{len(rows)-1}/{len(rows)}'});return
    if path=='/api/v2/transactions':state['writes']+=1;respond({'error':'Read-only test rejects writes'},500);return
    if path.startswith('/auth/v1/user'):respond(user);return
    if path.startswith('/auth/v1/logout'):respond({});return
    if path.startswith(('/api/','/auth/','/rest/')):state['unexpected'].append(path);respond({'error':'Unexpected fixture route'},500);return
    if url.hostname not in ('127.0.0.1','localhost'):state['unexpected'].append(url.hostname);route.abort();return
    route.continue_()
   context.route('**/*',route_request)
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(BASE+'/connect?tab=explore',wait_until='networkidle')
   page.get_by_role('heading',name='查清楚，再記下一筆').wait_for(timeout=30000)
   page.get_by_label('探索月份',exact=True).select_option('2026-10')
   page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click()
   page.locator('.lx-answer').wait_for();assert page.locator('.lx-metrics').get_by_text('NT$420',exact=True).count()==1
   assert page.locator('.lx-metrics').get_by_text('NT$370',exact=True).count()==1
   page.get_by_role('button',name='查看計算明細（3 筆）',exact=True).click()
   assert page.locator('.lx-evidence button').count()==3
   assert page.locator('.lx-evidence').get_by_text('外幣不可混算').count()==0
   page.get_by_label('帳務問題',exact=True).fill('今年投資多少報酬')
   page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click()
   page.get_by_role('alert').wait_for();assert page.locator('.lx-metrics').count()==0
   checks.append({'name':f'{engine}-{width} deterministic totals/evidence and unsupported-query rejection','status':'PASS'})
   page.get_by_label('記帳內容',exact=True).fill('午餐 120')
   page.get_by_role('button',name='解析草稿',exact=True).click();page.locator('.lx-draft').wait_for();assert state['writes']==0
   page.get_by_role('button',name='帶入記帳表單',exact=True).click()
   page.get_by_role('heading',name='記一筆',exact=True).wait_for()
   assert page.get_by_label('金額',exact=True).input_value()=='120.00'
   assert page.get_by_label('商家 / 項目',exact=True).input_value()=='午餐'
   assert state['writes']==0
   nav=page.locator('.ls-app-bottom-nav' if width<760 else '.ls-app-desktop-nav')
   nav.get_by_role('button',name='探索',exact=True).click()
   page.get_by_role('button',name='消費地點',exact=True).click()
   assert state['tiles']==0
   page.get_by_text('1 筆有定位支出 · NT$120',exact=True).wait_for()
   page.get_by_role('button',name='同意並載入地圖',exact=True).click()
   page.locator('.leaflet-container').wait_for()
   page.wait_for_function('document.querySelectorAll(".leaflet-tile").length > 0')
   assert state['tiles']>0
   assert page.get_by_role('link',name='OpenStreetMap',exact=True).count()==1
   page.get_by_role('button',name='關閉地圖，停止新的底圖請求',exact=True).click()
   assert page.locator('.leaflet-container').count()==0
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/f'locations-{engine}-{width}.png'),full_page=True)
   checks.append({'name':f'{engine}-{width} draft is not written; map needs consent; attribution and close work','status':'PASS'})
   page.get_by_role('button',name='帳本查詢',exact=True).click()
   page.get_by_label('帳務問題',exact=True).fill('2026-10餐飲多少？')
   page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click();page.locator('.lx-answer').wait_for()
   page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(OUT/f'query-{engine}-{width}.png'),full_page=True)
   # Browser signout clears query content rather than retaining financial answers.
   page.locator('.ls-app-signout').click();page.get_by_label('帳號名稱',exact=True).wait_for()
   assert page.locator('.lx-answer').count()==0 and page.locator('.lx-evidence').count()==0
   assert not errors,errors
   assert not state['unexpected'],state['unexpected']
   assert state['writes']==0
   checks.append({'name':f'{engine}-{width} logout clears query data; no writes, overflow or JS errors','status':'PASS'})
   context.close()
  except Exception as error:
   failure=error;checks.append({'name':f'{engine}-{width}','status':'FAIL','type':type(error).__name__,'message':str(error)[:500]});break
  finally:
   if browser:browser.close()
report={'status':'FAIL' if failure else 'PASS','scope':'isolated browser API/Auth/tile fixtures, no real data','checks':checks,'native_iPhone':False}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
if failure:raise failure
