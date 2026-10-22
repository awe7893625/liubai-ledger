"""Isolated UI acceptance: fixture-only Auth/API/data, never production credentials.
Validates rendering and interactions, not hosted-cloud persistence or real iPhone.
Run with Vite at 127.0.0.1:5204 and fixture.supabase.invalid configuration.
"""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse,parse_qs
import base64,calendar,json,time
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'.qa/planning-settings-20261022/ui';OUT.mkdir(parents=True,exist_ok=True)
APP='http://127.0.0.1:5204';NOW='2026-10-22T08:00:00Z';MONTH='2026-10'
def uid(n):return f'00000000-0000-4000-8000-{n:012d}'
def enc(v):return base64.urlsafe_b64encode(json.dumps(v).encode()).decode().rstrip('=')
def fixture_session(n=1):
    user={'id':uid(n),'aud':'authenticated','role':'authenticated','email':'fixture@example.invalid','app_metadata':{'provider':'email'},'user_metadata':{'display_name':'測試帳本'},'created_at':NOW}
    token=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':uid(n),'role':'authenticated','aud':'authenticated','exp':int(time.time())+3600})+'.fixture-invalid-signature'
    return {'access_token':token,'refresh_token':'fixture-only','expires_at':int(time.time())+3600,'expires_in':3600,'token_type':'bearer','user':user}
def initial():
    return {'prefs':{},'plans':[],'receipts':{},'transactions':[{'id':uid(30),'request_id':'fixture','source':'manual','amount_minor':-50000,'currency':'TWD','merchant':'房租付款','card_label':'日常卡','status':'confirmed','occurred_at':NOW,'account_id':uid(10),'category_id':uid(20),'note':None,'legacy_date':None,'legacy_kind':None,'updated_at':NOW}], 'errors':[]}
def preferences():return {'display_name':'','theme':'system','home_currency':'TWD','default_account_id':None,'default_category_id':None,'version':0,'updated_at':None}
def api(route,state):
    request=route.request;url=urlparse(request.url);path=url.path;q=parse_qs(url.query)
    def send(v,status=200,headers=None):
        route.fulfill(status=status,body=json.dumps(v),headers={'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':APP,'Access-Control-Allow-Headers':'*','Access-Control-Expose-Headers':'Content-Range',**(headers or {})})
    if request.method=='OPTIONS':send({});return
    try:
        auth=request.headers.get('authorization','').removeprefix('Bearer ');segment=auth.split('.')[1]
        owner=json.loads(base64.urlsafe_b64decode(segment+'='*(-len(segment)%4)))['sub']
    except Exception:owner=uid(1)
    body=request.post_data_json if request.post_data else {}
    accounts=[{'id':uid(10),'name':'日常卡','type':'card','currency':'TWD','issuer':None},{'id':uid(11),'name':'美元卡','type':'card','currency':'USD','issuer':None}]
    cats=[{'id':uid(20),'name':'餐飲','slug':'food'},{'id':uid(21),'name':'其他','slug':'other'}]
    if path=='/api/v2/bootstrap':send({'ok':True,'profile':{'user_id':owner,'plan':'free','locale':'zh-TW','timezone':'Asia/Taipei'},'accounts':accounts,'categories':cats,'preferences':state['prefs'].get(owner,preferences())});return
    if path=='/api/v2/devices':send({'ok':True,'devices':[],'onboarding':{'version':1,'devices':[],'checked_at':NOW}});return
    if path=='/api/v2/accounts':send({'ok':True,'accounts':accounts});return
    if path=='/api/v2/preferences':
        if request.method=='PUT':
            if body['version']!=state['prefs'].get(owner,preferences())['version']:send({'ok':False,'error':'設定已被另一台裝置更新，請重新載入再修改'},409);return
            state['prefs'][owner]={**body,'version':body['version']+1,'updated_at':NOW}
        send({'ok':True,'preferences':state['prefs'].get(owner,preferences())});return
    if path=='/api/v2/budgets':send({'ok':True,'budget':{'period_month':q.get('month',[MONTH])[0],'currency':q.get('currency',['TWD'])[0],'total_limit_minor':300000,'safety_buffer_minor':20000,'category_limits':{},'version':1,'updated_at':NOW}});return
    if path=='/api/v2/planning':
        month=q.get('month',[MONTH])[0];currency=q.get('currency',['TWD'])[0]
        if request.method in ('POST','PUT'):
            values={**body,'user_id':owner,'amount_minor':round(float(body['amount'])*100),'version':body.get('version',0)+1,'updated_at':NOW}
            state['plans']=[p for p in state['plans'] if not(p['id']==values['id'] and p['user_id']==owner)]+[values]
            send({'ok':True,'plan':values},201 if request.method=='POST' else 200);return
        if request.method=='PATCH':
            state['receipts'][(owner,body['plan_id'],body['month'])]={**body,'version':body['version']+1}
            send({'ok':True});return
        items=[]
        for p in state['plans']:
            if p['user_id']!=owner or p['currency']!=currency or p['start_month']>month or (p.get('end_month') and p['end_month']<month) or (p['recurrence']=='once' and month!=p['start_month']):continue
            receipt=state['receipts'].get((owner,p['id'],month),{})
            tx=next((t for t in state['transactions'] if t['id']==receipt.get('transaction_id')),None)
            status='paused' if not p['active'] else 'paid' if receipt.get('status')=='linked' and tx else 'skipped' if receipt.get('status')=='skipped' else 'open'
            year,m=map(int,month.split('-'));day=min(p['due_day'],calendar.monthrange(year,m)[1])
            items.append({**p,'due_date':f'{month}-{day:02d}','state':status,'outstanding_minor':p['amount_minor'] if status=='open' else 0,'receipt_version':receipt.get('version',0),'linked_transaction_id':tx['id'] if tx else None,'linked_amount_minor':-tx['amount_minor'] if tx else None,'payment_needs_review':False})
        send({'ok':True,'items':items,'outstanding_minor':sum(p['outstanding_minor'] for p in items)});return
    if path.startswith('/rest/v1/ledger_transactions'):
        txs=state['transactions'] if owner==uid(1) else []
        send(txs,headers={'Content-Range':f'0-{max(0,len(txs)-1)}/{len(txs)}'});return
    if path.startswith('/auth/v1/user'):send(fixture_session(1 if owner==uid(1) else 2)['user']);return
    if path.startswith(('/api/','/auth/','/rest/')):send({'ok':False,'error':'Unexpected fixture route'},500);return
    if url.hostname not in ('127.0.0.1','localhost'):route.abort();return
    route.continue_()

def main():
    checks=[];skips=[];failure=None
    def passed(name):checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
    with sync_playwright() as pw:
        for engine,width in [('chromium',390),('chromium',1280),('webkit',390)]:
            browser=None;contexts=[];state=initial()
            try:
                try:browser=getattr(pw,engine).launch(headless=True)
                except Exception as e:
                    if engine=='webkit':skips.append({'engine':engine,'reason':'WebKit runtime unavailable','error_type':type(e).__name__});continue
                    raise
                def make_context(n=1):
                    ctx=browser.new_context(viewport={'width':width,'height':844},color_scheme='light')
                    contexts.append(ctx)
                    ctx.add_init_script('localStorage.setItem("sb-fixture-auth-token",'+json.dumps(json.dumps(fixture_session(n)))+');')
                    ctx.route('**/*',lambda route:api(route,state))
                    return ctx
                context=make_context();page=context.new_page();page.on('pageerror',lambda e:state['errors'].append(str(e)))
                page.goto(APP+'/connect?tab=settings',wait_until='networkidle',timeout=30000)
                panel=page.get_by_role('region',name='一般設定',exact=True)
                page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden')
                panel.get_by_label('顯示暱稱',exact=True).fill('雲端偏好測試')
                panel.get_by_label('顯示模式',exact=True).select_option('dark')
                panel.get_by_label('預設檢視幣別',exact=True).select_option('USD')
                panel.get_by_label('預設付款帳戶',exact=True).select_option(uid(11))
                panel.get_by_label('預設分類',exact=True).select_option(uid(20))
                panel.get_by_role('button',name='儲存一般設定',exact=True).click()
                panel.get_by_text('已儲存到雲端，設定立即生效；其他裝置重新載入即可同步。',exact=True).wait_for()
                assert page.locator('.ls-app-root').get_attribute('data-theme')=='dark'
                assert page.locator('.ls-app-root').evaluate('(el)=>getComputedStyle(el).colorScheme')=='dark'
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                ratio=panel.get_by_role('button',name='重新載入設定',exact=True).evaluate('''el=>{const s=getComputedStyle(el);const lum=c=>{const rgb=c.match(/[\\d.]+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]};const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)}''')
                assert ratio>=4.5, 'Low-contrast secondary button'
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(OUT/f'preferences-dark-{engine}-{width}.png'),full_page=True)
                nav=page.locator('.ls-app-bottom-nav' if width<=760 else '.ls-app-desktop-nav')
                nav.get_by_role('button',name='首頁',exact=True).click()
                page.get_by_text('雲端偏好測試',exact=True).wait_for()
                assert page.get_by_label('總覽幣別',exact=True).input_value()=='USD'
                nav.get_by_role('button',name='記一筆',exact=True).click()
                page.get_by_role('heading',name='記一筆',exact=True).wait_for()
                assert page.get_by_label('帳戶',exact=True).input_value()==uid(11)
                assert page.get_by_label('分類',exact=True).input_value()==uid(20)
                for selector in ('input[type=datetime-local]','select'):
                    for elem in page.locator(selector).all():
                        rect=elem.bounding_box()
                        if rect:assert rect['x']>=0 and rect['x']+rect['width']<=width+1
                passed(f'{engine} {width}px preferences apply theme, home currency and capture defaults')
                # A fresh browser context receives the same persisted fixture account settings.
                second=make_context().new_page();second.goto(APP+'/connect?tab=settings',wait_until='networkidle')
                second.get_by_label('顯示暱稱',exact=True).wait_for();assert second.get_by_label('顯示暱稱',exact=True).input_value()=='雲端偏好測試'
                assert second.locator('.ls-app-root').get_attribute('data-theme')=='dark'
                other=make_context(2).new_page();other.goto(APP+'/connect?tab=settings',wait_until='networkidle')
                other.get_by_label('顯示暱稱',exact=True).wait_for();assert other.get_by_label('顯示暱稱',exact=True).input_value()==''
                assert other.locator('.ls-app-root').get_attribute('data-theme')=='light'
                passed(f'{engine} {width}px fresh context loads own preferences; other user remains separate')
                nav.get_by_role('button',name='首頁',exact=True).click()
                page.get_by_label('總覽月份',exact=True).select_option(MONTH)
                page.get_by_label('總覽幣別',exact=True).select_option('TWD')
                page.locator('details.ls-month-tools > summary').click()
                plan_panel=page.get_by_role('region',name='預留與固定支出',exact=True)
                plan_panel.get_by_role('button',name='新增預留項目',exact=True).click()
                plan_panel.get_by_label('預留項目名稱',exact=True).fill('每月房租')
                plan_panel.get_by_label('預留金額',exact=True).fill('1200')
                plan_panel.get_by_label('預計付款日',exact=True).fill('31')
                plan_panel.get_by_role('button',name='儲存預留項目',exact=True).click()
                plan_panel.get_by_text('每月房租',exact=True).wait_for()
                plan_panel.get_by_text('本期尚待支出 NT$1,200',exact=False).wait_for()
                budget=page.get_by_role('region',name='月預算管理',exact=True)
                budget.get_by_text('NT$1,100',exact=True).wait_for()
                assert len(state['transactions'])==1
                plan_panel.get_by_role('button',name='連結已付交易',exact=True).click()
                plan_panel.get_by_label('已記帳的付款',exact=True).select_option(uid(30))
                plan_panel.get_by_role('button',name='確認連結付款',exact=True).click()
                plan_panel.get_by_text('本期已付',exact=True).wait_for()
                budget.get_by_text('NT$2,300',exact=True).first.wait_for()
                assert len(state['transactions'])==1
                passed(f'{engine} {width}px reserve reduces available budget; linking payment releases it once')
                page.get_by_label('總覽月份',exact=True).select_option('2027-02')
                plan_panel.get_by_text('2027-02-28 · 每月',exact=False).wait_for()
                plan_panel.get_by_text('待付款',exact=True).wait_for()
                plan_panel.get_by_role('button',name='本期略過',exact=True).click()
                plan_panel.get_by_text('本期略過',exact=True).wait_for()
                page.get_by_label('總覽月份',exact=True).select_option('2027-03')
                plan_panel.get_by_text('2027-03-31 · 每月',exact=False).wait_for()
                plan_panel.get_by_text('待付款',exact=True).wait_for()
                page.evaluate('window.scrollTo(0,0)')
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=str(OUT/f'planner-dark-{engine}-{width}.png'),full_page=True)
                assert not state['errors'],state['errors']
                passed(f'{engine} {width}px February month-end, skip-only-one-period, no overflow or JS errors')
                second.get_by_label('顯示暱稱',exact=True).fill('第二台裝置設定')
                second.get_by_role('button',name='儲存一般設定',exact=True).click()
                second.get_by_text('已儲存到雲端，設定立即生效；其他裝置重新載入即可同步。',exact=True).wait_for()
                nav.get_by_role('button',name='設定',exact=True).click()
                panel.get_by_role('button',name='儲存一般設定',exact=True).click()
                panel.get_by_text('設定已被另一台裝置更新，請重新載入再修改',exact=True).wait_for()
                panel.get_by_role('button',name='重新載入設定',exact=True).click()
                page.wait_for_function('document.querySelector(\'[aria-label="顯示暱稱"]\').value === "第二台裝置設定"')
                other.emulate_media(color_scheme='dark')
                other.wait_for_function('document.querySelector(".ls-app-root").dataset.theme === "dark"')
                passed(f'{engine} {width}px stale preferences refused; reload and system theme work')
            except Exception as error:
                try:page.screenshot(path=str(OUT/f'failure-{engine}-{width}.png'),full_page=True)
                except Exception:pass
                failure=error;checks.append({'name':f'{engine}-{width}','status':'FAIL','error_type':type(error).__name__,'message':str(error)[:500]})
                break
            finally:
                for ctx in contexts:ctx.close()
                if browser:browser.close()
    report={'status':'FAIL' if failure else 'PASS','scope':'isolated browser fixtures; no production API or database access','checks':checks,'skips':skips,'native_iPhone_tested':False}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False,indent=2))
    if failure:raise failure

if __name__=='__main__':main()
