"""Isolated product acceptance: all Auth/API/data are fixtures, never real accounts.
Checks functional layouts in Chromium/WebKit, not physical iPhone/Wallet behavior.
"""
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64, copy, json, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.qa/product-finish-20261023/browser';OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5206';NOW='2026-10-23T04:00:00Z';UID='11111111-1111-4111-8111-111111111111'
def enc(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
user={'id':UID,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','app_metadata':{'provider':'email'},'user_metadata':{'display_name':'整合驗收','provider':'google'},'created_at':NOW}
session={'access_token':enc({'alg':'HS256'})+'.'+enc({'sub':UID,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.invalid-fixture','refresh_token':'fixture','expires_in':3600,'expires_at':int(time.time())+3600,'token_type':'bearer','user':user}
def tx(id,amount,**changes):return {'id':id,'request_id':id,'amount_minor':amount,'currency':'TWD','merchant':'測試 '+id,'status':'confirmed','occurred_at':NOW,'source':'manual','account_id':'a','category_id':'food','note':None,'updated_at':NOW,**changes}
initial=[tx('coffee',-12000,merchant='測試咖啡'),tx('dinner',-30000,occurred_at='2026-10-22T04:00:00Z'),tx('salary',100000,occurred_at='2026-10-20T04:00:00Z'),tx('usd',-99900,currency='USD',account_id='usd'),tx('refund',5000,legacy_kind='refund',source='statement'),tx('transfer',-100000,legacy_kind='transfer'),tx('pending',None,status='pending'),tx('history',-6000,legacy_date='2026-09-18')]
accounts=[{'id':'a','name':'日常信用卡','type':'card','currency':'TWD','issuer':None,'card_aliases':[]},{'id':'usd','name':'美元卡','type':'card','currency':'USD','issuer':None,'card_aliases':[]}]
checks=[];failure=None
with sync_playwright() as pw:
 for engine,width,height in [('chromium',320,740),('chromium',390,844),('chromium',430,932),('chromium',1280,900),('webkit',390,844)]:
  browser=None
  try:
   browser=getattr(pw,engine).launch(headless=True);context=browser.new_context(viewport={'width':width,'height':height},accept_downloads=True)
   context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+');')
   state={'rows':copy.deepcopy(initial),'cats':[{'id':'food','name':'餐飲','slug':'food'},{'id':'other','name':'其他','slug':'other'}],'unexpected':[],'logout_scopes':[]}
   def route_request(route):
    url=urlparse(route.request.url);path=url.path;method=route.request.method
    def respond(body,status=200,headers=None):route.fulfill(status=status,body=json.dumps(body),headers={'Content-Type':'application/json','Access-Control-Allow-Origin':BASE,'Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})})
    if method=='OPTIONS':respond({});return
    if path=='/api/v2/bootstrap':respond({'ok':True,'profile':{'user_id':UID,'locale':'zh-TW','timezone':'Asia/Taipei','plan':'free'},'accounts':accounts,'categories':state['cats']});return
    if path=='/api/v2/devices':respond({'ok':True,'devices':[],'onboarding':{'version':1,'devices':[],'checked_at':NOW}});return
    if path=='/api/v2/budgets':respond({'ok':True,'budget':None});return
    if path=='/api/v2/accounts':respond({'ok':True,'accounts':accounts});return
    if path=='/api/v2/categories':
     if method=='GET':respond({'ok':True,'categories':state['cats']});return
     body=route.request.post_data_json
     if method=='POST':item={'id':'new-'+str(len(state['cats'])),'name':body['name'],'slug':'custom-fixture'};state['cats'].append(item)
     else:
      item=next(row for row in state['cats'] if row['id']==body['id']);item['name']=body['name']
     respond({'ok':True,'category':item},201 if method=='POST' else 200);return
    if path.startswith('/rest/v1/ledger_transactions'):
     rows=sorted(state['rows'],key=lambda row:row['occurred_at'],reverse=True);respond(rows,headers={'Content-Range':f'0-{len(rows)-1}/{len(rows)}'});return
    if path=='/api/v2/transactions':
     body=route.request.post_data_json
     if method=='POST':
      item=tx('added-'+str(len(state['rows'])),-round(float(body['amount'])*100),merchant=body['merchant'],request_id=body['request_id'],category_id=body.get('category_id'),account_id=body.get('account_id'),note=body.get('note'));state['rows'].append(item)
      respond({'ok':True,'duplicate':False,'transaction':item},201);return
     if method=='PATCH':
      item=next(row for row in state['rows'] if row['id']==body['id']);item.update({key:value for key,value in body.items() if key not in ('amount','expected_updated_at')})
      if 'amount' in body:item['amount_minor']=-round(float(body['amount'])*100)
      respond({'ok':True,'transaction':item});return
     respond({'error':'Unexpected mutation'},500);return
    if path.startswith('/auth/v1/user'):respond(user);return
    if path.startswith('/auth/v1/logout'):state['logout_scopes'].append(parse_qs(url.query).get('scope',[''])[0]);respond({});return
    if path.startswith(('/api/','/auth/','/rest/')):state['unexpected'].append(path);respond({'error':'Unexpected fixture route'},500);return
    if url.hostname not in ('127.0.0.1','localhost'):state['unexpected'].append(url.hostname);route.abort();return
    route.continue_()
   context.route('**/*',route_request)
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(BASE+'/connect',wait_until='networkidle')
   page.get_by_role('heading',name='我的帳本',exact=True).wait_for(timeout=30000)
   page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden')
   assert page.locator('.ls-load-error').count()==0
   nav=page.locator('.ls-app-bottom-nav' if width<=760 else '.ls-app-desktop-nav')
   def go(label):nav.get_by_role('button',name=label,exact=True).click()
   def layout():
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal page overflow'
    if width<=760:
     boxes=page.evaluate('''() => {const r=s=>{let b=document.querySelector(s).getBoundingClientRect();return {top:b.top,bottom:b.bottom}};return {main:r('.ls-app-main'),nav:r('.ls-app-bottom-nav'),header:r('.ls-app-topbar'),vh:visualViewport.height}}''')
     assert boxes['main']['top']>=boxes['header']['bottom']-1,boxes
     assert boxes['main']['bottom']<=boxes['nav']['top']+1,boxes
     assert boxes['nav']['bottom']<=boxes['vh']+1,boxes
   layout();page.screenshot(path=str(OUT/f'home-{engine}-{width}.png'))
   page.locator('.lf-freshness summary').click();page.get_by_text('重新整理只讀取目前雲端帳本',exact=False).wait_for()
   checks.append({'name':f'{engine}-{width} home viewport reserves header/nav and distinguishes data freshness','status':'PASS'})
   go('記一筆');page.get_by_label('金額',exact=True).fill('12.50');page.get_by_label('商家 / 項目',exact=True).fill('測試表單')
   save=page.get_by_role('button',name='儲存交易',exact=True);save.scroll_into_view_if_needed();layout()
   if width<=760:
    box=save.bounding_box();main=page.locator('.ls-app-main').bounding_box();assert box['y']>=main['y']-1 and box['y']+box['height']<=main['y']+main['height']+1
   date=page.locator('input[type="datetime-local"]').bounding_box();card=page.locator('.ls-app-capture-card').bounding_box();assert date['x']+date['width']<=card['x']+card['width']
   page.screenshot(path=str(OUT/f'capture-{engine}-{width}.png'));save.click();page.get_by_role('heading',name='我的帳本',exact=True).wait_for();page.get_by_text('測試表單',exact=True).wait_for()
   checks.append({'name':f'{engine}-{width} date field contained, save reachable and manual form completes','status':'PASS'})
   go('交易');page.locator('.lf-more-filters summary').click()
   assert page.get_by_label('交易排序').locator('option[value="amount_desc"]').is_disabled()
   page.get_by_label('篩選幣別').select_option('TWD');page.get_by_label('交易排序').select_option('amount_desc')
   assert page.locator('.ls-app-transaction-row').first.get_by_text('測試 salary',exact=True).count()+page.locator('.ls-app-transaction-row').first.get_by_text('測試 transfer',exact=True).count()==1
   page.get_by_label('交易排序').select_option('newest');assert page.locator('.lf-day-groups section').count()>1
   page.get_by_label('搜尋交易').fill('測試咖啡')
   with page.expect_download() as info:page.get_by_role('button',name='匯出 CSV',exact=True).click()
   exported=Path(info.value.path()).read_text(encoding='utf-8-sig');assert '測試咖啡' in exported and '-120.00' in exported and '測試 usd' not in exported
   page.get_by_role('button',name='清除所有篩選',exact=True).click();page.locator('.ls-month-tools > summary').click();page.get_by_role('region',name='六個月收支趨勢',exact=True).wait_for()
   history=page.get_by_role('region',name='六個月收支趨勢',exact=True);history.locator('details summary').click();assert history.locator('tbody tr').count()==6
   layout();checks.append({'name':f'{engine}-{width} grouped/amount views, single-currency guard, exact CSV and trend evidence','status':'PASS'})
   go('設定');page.get_by_role('button',name='付款與分類',exact=True).click();panel=page.get_by_role('region',name='分類管理',exact=True)
   panel.get_by_label('分類名稱',exact=True).fill('寵物');panel.get_by_role('button',name='新增分類',exact=True).click();panel.get_by_role('button',name='修改分類 寵物',exact=True).wait_for()
   panel.get_by_role('button',name='修改分類 餐飲',exact=True).click();panel.get_by_label('分類名稱',exact=True).fill('飲食');panel.get_by_role('button',name='儲存分類名稱',exact=True).click();panel.get_by_role('button',name='修改分類 飲食',exact=True).wait_for()
   assert state['rows'][0]['category_id']=='food';go('交易');assert page.get_by_text('飲食',exact=False).count()>0
   checks.append({'name':f'{engine}-{width} payment/categories section and rename preserves transaction links','status':'PASS'})
   go('設定');page.get_by_role('button',name='一般設定',exact=True).click();page.get_by_label('顯示模式').select_option('dark')
   page.wait_for_function('document.querySelector(".ls-app-root")?.dataset.theme === "dark"')
   page.get_by_label('顯示暱稱').fill('本機驗收名稱');page.get_by_role('button',name='儲存暱稱',exact=True).click();layout();page.screenshot(path=str(OUT/f'settings-dark-{engine}-{width}.png'))
   page.once('dialog',lambda dialog:dialog.accept());page.get_by_role('button',name='登出其他瀏覽器',exact=True).click();page.get_by_text('其他登入的續期已取消',exact=False).wait_for();assert 'others' in state['logout_scopes'];assert page.locator('.ls-app-root').count()==1
   go('首頁');page.get_by_text('本機驗收名稱',exact=True).wait_for()
   page.reload(wait_until='networkidle');page.get_by_text('本機驗收名稱',exact=True).wait_for();assert page.locator('.ls-app-root').get_attribute('data-theme')=='dark'
   checks.append({'name':f'{engine}-{width} local appearance persists, other-session logout keeps current browser','status':'PASS'})
   go('探索');page.get_by_role('heading',name='查清楚，再記下一筆',exact=True).wait_for();layout()
   if width<=760:
    page.set_viewport_size({'width':width,'height':500});layout();page.set_viewport_size({'width':width,'height':height})
   page.locator('.ls-app-signout').click();page.get_by_label('帳號名稱',exact=True).wait_for();assert state['logout_scopes'][-1]=='local';assert page.locator('.lx-answer').count()==0
   assert not errors,errors;assert not state['unexpected'],state['unexpected']
   checks.append({'name':f'{engine}-{width} all tabs, viewport resize and local logout pass without JS errors','status':'PASS'})
   context.close()
  except Exception as error:
   failure=error;checks.append({'name':f'{engine}-{width}','status':'FAIL','type':type(error).__name__,'message':str(error)[:700]});break
  finally:
   if browser:browser.close()
report={'status':'FAIL' if failure else 'PASS','scope':'isolated browser/Auth/API fixtures, no real data or production writes','checks':checks,'physical_iPhone':False}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
if failure:raise failure
