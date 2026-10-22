"""Production acceptance with one public synthetic signup and exact-ID cleanup.
Never loads an owner's ledger. The map tile layer is intercepted so no scripted
OSM traffic is emitted. Native iPhone execution is outside this test.
"""
from pathlib import Path
from urllib.parse import urlparse
import argparse,base64,json,os,secrets,subprocess
from dotenv import dotenv_values
from e2e_shortcuts_v2 import request


def main():
 ap=argparse.ArgumentParser();ap.add_argument('--cleanup-env',required=True);ap.add_argument('--report',required=True);args=ap.parse_args()
 root=Path(__file__).resolve().parents[1];out=Path(args.report);out.parent.mkdir(parents=True,exist_ok=True)
 values=dotenv_values(args.cleanup_env);assert urlparse(values['SUPABASE_URL']).hostname=='vhosvmnhdrzkhmkmptqg.supabase.co'
 app='https://app.blankspaces.uk';run=secrets.token_hex(5);users=[];checks=[];failure=None;cleanup=[]
 def passed(name):checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
 try:
  assert request('GET',app+'/api/v2/health')['ok']
  username='qa_a_'+run;password='QA!'+secrets.token_urlsafe(24)
  signed=request('POST',app+'/api/v2/auth/signup',body={'username':username,'password':password},expected=(201,))
  token=signed['session']['access_token'];claim=token.split('.')[1];uid=json.loads(base64.urlsafe_b64decode(claim+'='*(-len(claim)%4)))['sub']
  users.append({'id':uid,'username':username});manifest={'run_id':run,'users':users}
  m=out.parent/'cleanup-manifest.json';m.write_text(json.dumps(manifest));m.chmod(0o600)
  headers={'Authorization':'Bearer '+token}
  config=request('POST',app+'/api/v2/bootstrap',headers,{})
  for i,(amount,merchant,direction,note) in enumerate([(120,'QA Coffee '+run,'expense','🗺️25.033,121.565 · 📍QA fixture'),(30,'QA Lunch '+run,'expense',None),(200,'QA Income '+run,'income',None)]):
   saved=request('POST',app+'/api/v2/transactions',headers,{'amount':amount,'merchant':merchant,'direction':direction,'note':note,'account_id':config['accounts'][0]['id'],'category_id':config['categories'][0]['id'],'occurred_at':'2026-10-22T04:00:00+08:00','currency':'TWD','request_id':f'qa-explore-{run}-{i}'},expected=(201,))
   assert saved['ok']
  passed('public signup and three isolated hosted ledger fixtures created')
  from playwright.sync_api import sync_playwright
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True)
   try:
    context=browser.new_context(viewport={'width':390,'height':844});page=context.new_page();errors=[];tiles=[];writes=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda req:writes.append(req.url) if req.method in ('POST','PATCH','DELETE') and urlparse(req.url).path=='/api/v2/transactions' else None)
    def tile_fixture(route):
     tiles.append(route.request.url)
     route.fulfill(status=200,content_type='image/png',body=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZJkAAAAASUVORK5CYII='))
    context.route('https://tile.openstreetmap.org/**',tile_fixture)
    page.goto(app+'/connect?tab=explore',wait_until='networkidle',timeout=60000)
    page.get_by_label('帳號名稱',exact=True).fill(username);page.get_by_label('密碼',exact=True).fill(password);page.locator('.ls-auth-submit').click()
    page.get_by_role('heading',name='查清楚，再記下一筆').wait_for(timeout=30000)
    page.get_by_label('帳務問題',exact=True).fill('2026-10花多少？')
    page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click()
    page.locator('.lx-answer').wait_for();assert page.locator('.lx-metrics').get_by_text('NT$150',exact=True).count()==2
    assert page.locator('.lx-metrics').get_by_text('NT$200',exact=True).count()==1
    page.get_by_role('button',name='查看計算明細（3 筆）',exact=True).click();assert page.locator('.lx-evidence button').count()==3
    page.get_by_label('帳務問題',exact=True).fill('幫我預測投資報酬多少')
    page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click();page.get_by_role('alert').wait_for()
    assert page.locator('.lx-metrics').count()==0
    passed('real hosted login, exact scoped totals/evidence and unknown-query rejection')
    page.get_by_label('記帳內容',exact=True).fill('早餐 65');page.get_by_role('button',name='解析草稿',exact=True).click();page.locator('.lx-draft').wait_for()
    page.get_by_role('button',name='帶入記帳表單',exact=True).click();page.get_by_role('heading',name='記一筆',exact=True).wait_for()
    assert page.get_by_label('金額',exact=True).input_value()=='65.00'
    assert page.get_by_label('商家 / 項目',exact=True).input_value()=='早餐'
    assert not writes
    page.locator('.ls-app-bottom-nav').get_by_role('button',name='探索',exact=True).click()
    page.get_by_role('button',name='消費地點',exact=True).click();page.get_by_label('探索月份',exact=True).select_option('2026-10')
    page.get_by_text('1 筆有定位支出 · NT$120',exact=True).wait_for();assert not tiles
    page.get_by_role('button',name='同意並載入地圖',exact=True).click();page.locator('.leaflet-container').wait_for();page.wait_for_function('document.querySelectorAll(".leaflet-tile").length>0')
    assert tiles and page.get_by_role('link',name='OpenStreetMap',exact=True).count()==1
    page.get_by_role('button',name='關閉地圖，停止新的底圖請求',exact=True).click();assert not page.locator('.leaflet-container').count()
    passed('real ledger location parsing and draft handoff; no transaction writes from exploration; consent gate')
    page.get_by_role('button',name='帳本查詢',exact=True).click();page.get_by_label('帳務問題',exact=True).fill('2026-10商家排行');page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click();page.locator('.lx-ranking').wait_for()
    assert page.locator('.lx-ranking li').count()==2
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.evaluate('window.scrollTo(0,0)');page.screenshot(path=str(out.parent/'production-query-390.png'),full_page=True)
    assert not errors,errors
    rest={'apikey':values.get('SUPABASE_ANON_KEY') or values.get('SUPABASE_PUBLISHABLE_KEY'),**headers}
    rows=request('GET',values['SUPABASE_URL']+'/rest/v1/ledger_transactions?select=id&user_id=eq.'+uid,rest)
    assert len(rows)==3
    passed('production 390px layout and unchanged three-row fixture ledger')
    page.locator('.ls-app-signout').click();page.get_by_label('帳號名稱',exact=True).wait_for();assert page.locator('.lx-answer').count()==0
    passed('logout removes financial query state')
    context.close()
   finally:browser.close()
 except Exception as error:
  failure=error;checks.append({'name':'run','status':'FAIL','type':type(error).__name__,'message':str(error)[:400]})
 finally:
  if users:
   try:
    env=os.environ.copy()
    for key in ('SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'):
     if values.get(key):env[key]=values[key]
    result=subprocess.run(['node',str(root/'scripts/cleanup_shortcuts_qa.mjs')],input=json.dumps({'run_id':run,'users':users}),text=True,capture_output=True,env=env,timeout=60)
    if result.returncode:raise RuntimeError('Exact-ID synthetic cleanup failed; retain manifest')
    cleanup=json.loads(result.stdout)['cleanup']
   except Exception as error:failure=failure or error;cleanup=[{'synthetic_user_removed':False,'type':type(error).__name__}]
  report={'status':'FAIL' if failure else 'PASS','scope':'real brand domain, synthetic public user only','checks':checks,'cleanup':cleanup,'tiles':'intercepted local test fixtures, no automated OSM requests','native_iPhone':False}
  out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
 if failure:raise failure
 print('PASS hosted exploration acceptance; exact synthetic user cleaned',flush=True)
if __name__=='__main__':main()
