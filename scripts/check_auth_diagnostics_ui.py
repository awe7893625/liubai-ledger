"""Isolated auth/release UX tests: every Auth/API request is intercepted.
No real signup, rate-counter modification, private data or hosted DDL.
"""
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
import base64, json, time
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.qa/completion-20261023/browser';OUT.mkdir(parents=True,exist_ok=True)
BASE='http://127.0.0.1:5206';UID='11111111-1111-4111-8111-111111111111'
NOW=datetime.now(timezone.utc).isoformat();checks=[];failure=None

def enc(value):return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
user={'id':UID,'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','user_metadata':{'provider':'google','display_name':'診斷測試'},'app_metadata':{'provider':'email'},'created_at':NOW}
session={'access_token':enc({'alg':'HS256'})+'.'+enc({'sub':UID,'aud':'authenticated','role':'authenticated','exp':int(time.time())+3600})+'.fixture-not-valid','refresh_token':'fixture-only','expires_at':int(time.time())+3600,'expires_in':3600,'token_type':'bearer','user':user}

def passed(name):checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)

with sync_playwright() as pw:
 for engine,width,height in [('chromium',320,740),('chromium',390,844),('chromium',1280,900),('webkit',390,844)]:
  browser=None
  try:
   browser=getattr(pw,engine).launch(headless=True)
   state={'signup':0,'login':0,'health':0,'version':0,'broken':False,'unexpected':[],'mutations':0}
   def intercept(route):
    url=urlparse(route.request.url);path=url.path;method=route.request.method
    def respond(body,status=200,headers=None):
     route.fulfill(status=status,body=json.dumps(body),headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':BASE,'Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})})
    if method=='OPTIONS':respond({});return
    if path=='/api/v2/auth/signup':
     state['signup']+=1
     respond({'ok':False,'error':'Too many attempts. Try again later.','retry_after_seconds':120},429,{'Retry-After':'120'}) if state['signup']==1 else respond({'ok':False,'error':'Username is already taken'},409)
     return
    if path=='/api/v2/auth/login':state['login']+=1;respond({'ok':False,'error':'Invalid username or password'},401);return
    if path=='/auth/v1/user':respond(user);return
    if path=='/api/v2/bootstrap':respond({'ok':True,'profile':{'user_id':UID,'plan':'free','locale':'zh-TW','timezone':'Asia/Taipei'},'accounts':[],'categories':[]});return
    if path=='/api/v2/devices':respond({'ok':True,'devices':[],'onboarding':{'version':1,'devices':[],'checked_at':NOW}});return
    if path.startswith('/rest/v1/ledger_transactions'):respond([],headers={'Content-Range':'0-0/0'});return
    if path=='/api/v2/health':
     assert 'authorization' not in route.request.headers
     state['health']+=1;respond({'ok':not state['broken'],'service':'liubai-ledger-cloud'},503 if state['broken'] else 200);return
    if path=='/version.json':
     assert 'authorization' not in route.request.headers
     state['version']+=1;respond({'product':'liubai-ledger','source_revision':'1'*40,'built_at':NOW,'source_modified':False});return
    if path.startswith(('/api/','/auth/','/rest/')):state['unexpected'].append(path);respond({'error':'Unexpected fixture request'},500);return
    if url.hostname not in ('127.0.0.1','localhost'):state['unexpected'].append(url.hostname);route.abort();return
    route.continue_()
   context=browser.new_context(viewport={'width':width,'height':height})
   context.route('**/*',intercept);page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
   page.clock.install(time=datetime.now(timezone.utc))
   page.goto(BASE+'/connect',wait_until='networkidle')
   page.get_by_role('button',name='註冊',exact=True).click()
   page.get_by_label('帳號名稱',exact=True).fill('fixture_signup');page.get_by_label('密碼',exact=True).fill('Fixture-Password-123')
   page.locator('.ls-auth-submit').click();page.get_by_role('region',name='驗證等待時間',exact=True).wait_for()
   expect(page.locator('.ls-auth-submit')).to_be_disabled()
   page.evaluate('document.querySelector(".ls-auth-submit").click()');assert state['signup']==1
   raw=page.evaluate('sessionStorage.getItem("ledger-auth-cooldowns-v1")')
   assert set(json.loads(raw))=={'signup'} and 'Fixture-Password' not in raw and 'fixture_signup' not in raw
   assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   page.screenshot(path=str(OUT/f'cooldown-{engine}-{width}.png'),full_page=True)
   passed(f'{engine}-{width} server cooldown is visible, repeat submissions stopped, no credentials persisted')
   page.reload(wait_until='networkidle');page.get_by_role('button',name='註冊',exact=True).click()
   page.get_by_role('region',name='驗證等待時間',exact=True).wait_for();expect(page.locator('.ls-auth-submit')).to_be_disabled()
   page.clock.fast_forward(121000)
   page.get_by_label('帳號名稱',exact=True).fill('fixture_signup');page.get_by_label('密碼',exact=True).fill('Fixture-Password-123')
   expect(page.locator('.ls-auth-submit')).to_be_enabled()
   assert state['signup']==1,'Expiry must never automatically submit credentials'
   page.locator('.ls-auth-submit').click();page.get_by_text('這個帳號名稱已被使用，請選另一個名稱；已有帳號請切換登入。',exact=True).wait_for()
   assert state['signup']==2
   page.get_by_role('button',name='登入',exact=True).first.click();page.locator('.ls-auth-submit').click()
   page.get_by_text('帳號或密碼不正確。',exact=True).wait_for();assert state['login']==1
   passed(f'{engine}-{width} reload keeps cooldown, expiry enables manual retry, localized errors work')
   context.close()
   context=browser.new_context(viewport={'width':width,'height':height})
   context.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(session))+');Object.defineProperty(navigator,"clipboard",{value:{writeText:async text=>{window.__diagnostic=text}},configurable:true});')
   context.route('**/*',intercept);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
   page.goto(BASE+'/connect?tab=settings&section=general',wait_until='networkidle')
   panel=page.get_by_role('region',name='服務狀態與版本',exact=True);panel.wait_for()
   assert state['health']==state['version']==0,'No background health poll on page mount'
   panel.get_by_role('button',name='檢查連線（不記帳）',exact=True).click()
   panel.get_by_text('正常',exact=True).wait_for();panel.get_by_text('111111111111',exact=True).wait_for()
   panel.get_by_role('button',name='複製診斷資訊',exact=True).click()
   page.wait_for_function('typeof window.__diagnostic === "string"')
   diagnostic=page.evaluate('window.__diagnostic');data=json.loads(diagnostic)
   assert set(data)=={'product','revision','built_at','service_check','checked_at','page','excludes'}
   assert UID not in diagnostic and 'fixture@example' not in diagnostic and session['access_token'] not in diagnostic
   assert 'source_revision' not in data and data['revision']=='1'*40
   assert state['signup']==2 and state['login']==1
   panel.scroll_into_view_if_needed();assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
   page.screenshot(path=str(OUT/f'diagnostic-{engine}-{width}.png'))
   passed(f'{engine}-{width} explicit no-write health/version check and redacted support copy work')
   state['broken']=True;panel.get_by_role('button',name='檢查連線（不記帳）',exact=True).click()
   panel.get_by_role('alert').wait_for();panel.get_by_text('尚未確認',exact=True).wait_for()
   state['broken']=False;panel.get_by_role('button',name='檢查連線（不記帳）',exact=True).click();panel.get_by_text('正常',exact=True).wait_for()
   assert not state['unexpected'],state['unexpected'];assert not errors,errors
   passed(f'{engine}-{width} failed health is not misreported as lost data or successful sync')
   context.close()
  except Exception as error:
   failure=error;checks.append({'name':f'{engine}-{width}','status':'FAIL','type':type(error).__name__,'message':str(error)[:500]});break
  finally:
   if browser:browser.close()
report={'status':'FAIL' if failure else 'PASS','scope':'isolated Auth/API fixtures; no live signup or data writes','checks':checks,'physical_iPhone':False}
(OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
if failure:raise failure
print(json.dumps(report,ensure_ascii=False,indent=2))
