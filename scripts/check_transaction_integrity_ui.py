"""Isolated transaction classification/review browser QA. Every Auth/API request
is intercepted. No real identities, bank data, database writes or external tiles.
"""
from pathlib import Path
from urllib.parse import urlparse
import base64, copy, json, time
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'.qa/transaction-integrity-20261023/browser';OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5206';NOW='2026-10-23T04:00:00Z';UID='11111111-1111-4111-8111-111111111111'
def enc(v):return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
user={'id':UID,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','user_metadata':{'display_name':'帳務核對測試'},'app_metadata':{'provider':'email'},'created_at':NOW}
session={'access_token':enc({'alg':'HS256'})+'.'+enc({'sub':UID,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.invalid-fixture','refresh_token':'fixture','expires_at':int(time.time())+3600,'expires_in':3600,'token_type':'bearer','user':user}
def row(id,source,**kw):return {'id':id,'request_id':id,'merchant':'測試咖啡','amount_minor':-10000,'currency':'TWD','occurred_at':NOW,'status':'confirmed','account_id':'a','category_id':'food','source':source,'legacy_kind':None,'updated_at':NOW,'note':None,**kw}
initial=[row('wallet','apple_pay'),row('email','email'),row('pending','apple_pay',merchant=None,amount_minor=None,status='pending')]
accounts=[{'id':'a','name':'日常卡','currency':'TWD','type':'card','issuer':None,'card_aliases':[]}];cats=[{'id':'food','name':'餐飲','slug':'food'}]
checks=[];failure=None
with sync_playwright() as pw:
 for engine,width in [('chromium',320),('chromium',390),('chromium',1280),('webkit',390)]:
  browser=None
  try:
   browser=getattr(pw,engine).launch(headless=True);context=browser.new_context(viewport={'width':width,'height':844})
   context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+');')
   state={'rows':copy.deepcopy(initial),'unexpected':[],'stale_delete':False,'updates':[]}
   def route_request(route):
    url=urlparse(route.request.url);path=url.path;method=route.request.method
    def respond(data,status=200,headers=None):route.fulfill(status=status,body=json.dumps(data),headers={'Content-Type':'application/json','Access-Control-Allow-Origin':BASE,'Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})})
    if method=='OPTIONS':respond({});return
    if path=='/api/v2/bootstrap':respond({'ok':True,'profile':{'user_id':UID,'plan':'free'},'accounts':accounts,'categories':cats});return
    if path=='/api/v2/devices':respond({'ok':True,'devices':[],'onboarding':{'version':1,'devices':[],'checked_at':NOW}});return
    if path=='/api/v2/budgets':respond({'ok':True,'budget':None});return
    if path.startswith('/rest/v1/ledger_transactions'):
     rows=sorted(state['rows'],key=lambda r:r['occurred_at'],reverse=True);respond(rows,headers={'Content-Range':f'0-{len(rows)-1}/{len(rows)}'});return
    if path=='/api/v2/transactions':
     body=route.request.post_data_json
     if method=='POST':
      kind=body['kind'];amount=round(float(body['amount'])*100)
      item=row('added','manual',merchant=body['merchant'],amount_minor=amount if kind in ('income','refund') else -amount,legacy_kind=kind,occurred_at=body['occurred_at'],request_id=body['request_id'])
      state['rows'].append(item);respond({'ok':True,'duplicate':False,'transaction':item},201);return
     item=next(r for r in state['rows'] if r['id']==body['id'])
     if body.get('expected_updated_at')!=item['updated_at']:respond({'ok':False,'error':'交易已被更新，請重新載入'},409);return
     if method=='DELETE':
      assert state['stale_delete'];respond({'ok':False,'error':'交易在刪除前已變更，請重新載入確認'},409);return
     if method=='PATCH':
      state['updates'].append(body)
      kind=body.get('kind',item.get('legacy_kind'))
      for key in ('merchant','status','note','account_id','category_id'):
       if key in body:item[key]=body[key]
      if 'amount' in body:
       amount=round(float(body['amount'])*100);positive=kind in ('refund','income') or (kind=='transfer' and body.get('direction')=='income');item['amount_minor']=amount if positive else -amount
      item['legacy_kind']=kind;item['updated_at']=f"2026-10-23T04:00:{len(state['updates']):02d}Z"
      respond({'ok':True,'transaction':item});return
    if path.startswith('/auth/v1/user'):respond(user);return
    if path.startswith(('/api/','/auth/','/rest/')):state['unexpected'].append(path);respond({'error':'Unexpected fixture request'},500);return
    if url.hostname not in ('127.0.0.1','localhost'):state['unexpected'].append(url.hostname);route.abort();return
    route.continue_()
   context.route('**/*',route_request)
   page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(BASE+'/connect',wait_until='networkidle');page.get_by_role('heading',name='我的帳本',exact=True).wait_for()
   page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden')
   nav=page.locator('.ls-app-bottom-nav' if width<=760 else '.ls-app-desktop-nav')
   def go(name):nav.get_by_role('button',name=name,exact=True).click()
   def save():
    page.get_by_role('dialog').get_by_role('button',name='儲存變更',exact=True).click();page.get_by_role('dialog').wait_for(state='hidden')
    page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden')
   go('記一筆');page.get_by_role('button',name='退款',exact=True).click();page.get_by_label('金額',exact=True).fill('20');page.get_by_label('商家 / 項目',exact=True).fill('測試退款')
   page.get_by_role('button',name='儲存交易',exact=True).click();page.get_by_role('heading',name='我的帳本',exact=True).wait_for();page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden')
   added=state['rows'][-1];assert added['legacy_kind']=='refund' and added['amount_minor']==2000
   checks.append({'name':f'{engine}-{width} refund form sends explicit kind and positive refund amount','status':'PASS'})
   go('交易');review=page.get_by_label('帳務核對',exact=True);review.locator('summary').click();review.get_by_role('button',name='核對 測試咖啡 郵件',exact=True).click()
   page.get_by_label('編輯狀態',exact=True).select_option('duplicate');save()
   assert len(state['rows'])==4 and state['rows'][1]['status']=='duplicate'
   duplicate=page.locator('.ls-app-transaction-row').filter(has_text='已排除重複').filter(has_text='測試咖啡')
   duplicate.get_by_role('button',name='編輯 測試咖啡',exact=True).click();assert page.get_by_label('編輯狀態',exact=True).input_value()=='duplicate'
   page.get_by_label('編輯備註',exact=True).fill('核對保留');save();assert state['rows'][1]['status']=='duplicate'
   checks.append({'name':f'{engine}-{width} candidate is manually excluded, row retained and reopening preserves duplicate status','status':'PASS'})
   duplicate.get_by_role('button',name='編輯 測試咖啡',exact=True).click();page.get_by_label('編輯狀態',exact=True).select_option('confirmed');page.get_by_label('編輯交易類型',exact=True).select_option('transfer');page.get_by_label('轉帳方向',exact=True).select_option('expense');save()
   assert state['rows'][1]['legacy_kind']=='transfer' and state['rows'][1]['amount_minor']==-10000 and state['rows'][1]['source']=='email'
   page.locator('.lf-more-filters summary').click();page.get_by_label('篩選交易類型',exact=True).select_option('refund');assert page.locator('.ls-app-transaction-row').count()==1
   page.get_by_role('button',name='清除所有篩選',exact=True).click()
   checks.append({'name':f'{engine}-{width} transfer reclassification preserves source and refund type filter works','status':'PASS'})
   page.get_by_role('button',name='編輯 交易',exact=True).click();page.get_by_label('編輯狀態',exact=True).select_option('duplicate');save()
   assert state['rows'][2]['amount_minor'] is None and state['rows'][2]['status']=='duplicate'
   checks.append({'name':f'{engine}-{width} incomplete Wallet record can be excluded without inventing an amount','status':'PASS'})
   state['stale_delete']=True;page.once('dialog',lambda dialog:dialog.accept());page.get_by_role('button',name='刪除 測試退款',exact=True).click();page.locator('.ls-app-toast').filter(has_text='未刪除').wait_for()
   assert len(state['rows'])==4;assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   if width<=760:
    boxes=page.evaluate("() => ({main:document.querySelector('.ls-app-main').getBoundingClientRect().bottom,nav:document.querySelector('.ls-app-bottom-nav').getBoundingClientRect().top})")
    assert boxes['main']<=boxes['nav']+1
   page.screenshot(path=str(OUT/f'review-{engine}-{width}.png'))
   assert not errors,errors;assert not state['unexpected'],state['unexpected']
   checks.append({'name':f'{engine}-{width} stale delete retains record, content/nav fit and no JS errors','status':'PASS'})
  except Exception as error:
   failure=error;checks.append({'name':f'{engine}-{width}','status':'FAIL','type':type(error).__name__,'message':str(error)[:600]});break
  finally:
   if browser:browser.close()
report={'status':'FAIL' if failure else 'PASS','scope':'isolated browser fixtures; no real data/auth writes','checks':checks,'physical_iPhone':False}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
if failure:raise failure
