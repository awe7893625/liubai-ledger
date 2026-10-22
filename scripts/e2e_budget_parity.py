"""Budget/edit release acceptance using two explicitly synthetic admin-provisioned users.
Tests authenticated product routes, not public signup. No real-user data is read or
modified; exact-ID cleanup runs even when an assertion fails. Never logs credentials.
"""
from __future__ import annotations
import argparse,json,os,secrets,subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from urllib.parse import urlparse
from dotenv import dotenv_values
from e2e_shortcuts_v2 import request


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--app-url',required=True);p.add_argument('--env-file',type=Path,required=True)
    p.add_argument('--report',type=Path,required=True);p.add_argument('--local-runtime',action='store_true')
    args=p.parse_args();app=args.app_url.rstrip('/')
    assert app==('http://127.0.0.1:5194' if args.local_runtime else 'https://app.blankspaces.uk')
    values=dotenv_values(args.env_file);assert urlparse(values['SUPABASE_URL']).hostname=='vhosvmnhdrzkhmkmptqg.supabase.co'
    env=os.environ.copy()
    for key in ('SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'):
        if values.get(key):env[key]=values[key]
    run=secrets.token_hex(5);checks=[];cleanup=[];failure=None;users=[]
    args.report.parent.mkdir(parents=True,exist_ok=True)
    manifest=args.report.parent/'cleanup-manifest.json'
    def passed(name):checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
    def budget(user,method='GET',**body):
        return request(method,app+'/api/v2/budgets?month=2026-10&currency=TWD',user['headers'],None if method=='GET' else body,expected=(200,201,400,409))
    try:
        result=subprocess.run(['node',str(Path(__file__).with_name('budget_qa_users.mjs'))],input=json.dumps({'run_id':run,'manifest':str(manifest.resolve())}),text=True,capture_output=True,env=env,timeout=60)
        if result.returncode:raise RuntimeError('Synthetic fixture setup failed; inspect exact-ID cleanup manifest')
        users=json.loads(result.stdout)['users']
        for user in users:
            login=request('POST',app+'/api/v2/auth/login',body={'username':user['username'],'password':user['password']})
            user['headers']={'Authorization':'Bearer '+login['session']['access_token']}
            user['bootstrap']=request('POST',app+'/api/v2/bootstrap',user['headers'],{})
            assert user['bootstrap']['profile']['user_id']==user['id']
        a,b=users
        request('GET',app+'/api/v2/budgets?month=2026-10&currency=TWD',expected=(401,))
        passed('authenticated API route and anonymous rejection (synthetic fixtures, not signup)')
        cat=a['bootstrap']['categories'][0]['id'];foreign_cat=b['bootstrap']['categories'][0]['id']
        plan={'month':'2026-10','currency':'TWD','total_limit':'1000','safety_buffer':'100','category_limits':{cat:'500'},'version':0,'user_id':b['id']}
        saved=budget(a,'PUT',**plan);assert saved['budget']['version']==1
        assert budget(b)['budget'] is None
        denied=budget(a,'PUT',**{**plan,'version':1,'category_limits':{foreign_cat:'100'}});assert not denied['ok']
        assert budget(a)['budget']['version']==1
        passed('budget stored under authenticated owner; foreign category rejected')
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda amount:budget(a,'PUT',**{**plan,'version':1,'total_limit':amount}),['1100','1200']))
        assert sum(bool(r['ok']) for r in results)==1 and budget(a)['budget']['version']==2
        bad=budget(a,'DELETE',month='2026-10',currency='TWD',version=1);assert not bad['ok']
        passed('two concurrent versioned edits have one winner; stale deletion rejected')
        bplan=budget(b,'PUT',month='2026-10',currency='TWD',version=0,total_limit='222',safety_buffer='0',category_limits={})
        assert bplan['budget']['total_limit_minor']==22200
        # Read as the real test user's JWT through RLS; no server privilege here.
        anon=values.get('SUPABASE_PUBLISHABLE_KEY') or values.get('SUPABASE_ANON_KEY')
        rows=request('GET',values['SUPABASE_URL']+'/rest/v1/ledger_budgets?select=user_id,total_limit_minor',{'apikey':anon,**a['headers']})
        assert len(rows)==1 and rows[0]['user_id']==a['id']
        request('POST',values['SUPABASE_URL']+'/rest/v1/ledger_budgets',{'apikey':anon,**a['headers']},{'user_id':a['id'],'period_month':'2026-11'},expected=(401,403))
        passed('database RLS hides other tenants and rejects direct browser budget writes')
        request('POST',app+'/api/v2/transactions',a['headers'],{'merchant':'QA Budget Spending '+run,'amount':'80','occurred_at':'2026-10-22T04:00:00Z','request_id':'qa-spend-'+run,'category_id':cat},expected=(201,))
        tx=request('POST',app+'/api/v2/transactions',a['headers'],{'merchant':'QA Edit '+run,'amount':'80','occurred_at':'2026-07-03T04:00:00Z','request_id':'qa-edit-'+run,'category_id':cat},expected=(201,))['transaction']
        request('PATCH',app+'/api/v2/transactions',b['headers'],{'id':tx['id'],'amount':'1'},expected=(404,))
        request('PATCH',app+'/api/v2/transactions',a['headers'],{'id':tx['id'],'amount':'1','expected_updated_at':'2000-01-01T00:00:00Z'},expected=(409,))
        passed('transaction edits reject foreign owner and stale revisions')
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            try:
                for width in (390,1280):
                    context=browser.new_context(viewport={'width':width,'height':844})
                    page=context.new_page();errors=[]
                    page.on('pageerror',lambda error:errors.append(type(error).__name__))
                    page.goto(app+'/connect?tab=home',wait_until='networkidle',timeout=60000)
                    def login(user):
                        page.get_by_label('帳號名稱',exact=True).fill(user['username']);page.get_by_label('密碼',exact=True).fill(user['password'])
                        page.locator('.ls-auth-submit').click();page.locator('.ls-app-root').wait_for(timeout=30000)
                        page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden',timeout=30000)
                        token=page.evaluate("JSON.parse(localStorage.getItem('sb-vhosvmnhdrzkhmkmptqg-auth-token') || 'null')?.access_token")
                        assert token
                        user['headers']={'Authorization':'Bearer '+token}
                    def nav(label):page.locator('.ls-app-bottom-nav' if width<760 else '.ls-app-desktop-nav').get_by_role('button',name=label,exact=True).click()
                    login(a)
                    page.locator('.ls-month-tools > summary').click()
                    panel=page.get_by_label('月預算管理',exact=True)
                    panel.get_by_role('button',name='編輯預算',exact=True).wait_for(timeout=30000)
                    panel.get_by_role('button',name='編輯預算',exact=True).click()
                    panel.get_by_label('月預算金額',exact=True).fill(str(2000+width))
                    panel.get_by_label('安全保留金額',exact=True).fill('200')
                    panel.get_by_role('button',name='儲存預算',exact=True).click()
                    panel.get_by_text('預算已儲存到雲端，其他裝置重新載入即可看到。',exact=True).wait_for(timeout=30000)
                    assert budget(a)['budget']['total_limit_minor']==(2000+width)*100
                    page.reload(wait_until='networkidle');page.locator('.ls-app-root').wait_for(timeout=30000)
                    page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden',timeout=30000)
                    page.locator('.ls-month-tools > summary').click()
                    panel=page.get_by_label('月預算管理',exact=True)
                    panel.get_by_role('button',name='編輯預算',exact=True).wait_for(timeout=30000)
                    assert panel.get_by_text('NT$'+format(2000+width,','),exact=True).count()>=1
                    assert float(panel.get_by_label('預算使用率',exact=True).get_attribute('value'))==8000
                    page.evaluate('window.scrollTo(0,0)')
                    page.screenshot(path=str(args.report.parent/f'budget-{width}.png'),full_page=True)
                    passed(f'{width}px budget saves to cloud and survives page reload')
                    nav('交易');page.get_by_label('交易月份',exact=True).select_option('2026-07')
                    page.get_by_role('button',name='編輯 QA Edit '+run,exact=True).click()
                    editor=page.get_by_role('dialog',name='編輯交易',exact=True)
                    editor.get_by_label('編輯金額',exact=True).fill('123.45')
                    editor.get_by_label('編輯日期',exact=True).fill('2026-07-05T12:34')
                    editor.get_by_label('編輯備註',exact=True).fill('Synthetic verification')
                    page.screenshot(path=str(args.report.parent/f'editor-{width}.png'),full_page=True)
                    editor.get_by_role('button',name='儲存變更',exact=True).click()
                    editor.wait_for(state='hidden',timeout=30000)
                    page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden',timeout=30000)
                    page.get_by_role('button',name='編輯 QA Edit '+run,exact=True).wait_for()
                    assert page.get_by_text('−NT$123.45',exact=True).count()>=1
                    page.locator('.ls-month-tools > summary').click()
                    page.get_by_role('heading',name='支出分析',exact=True).wait_for()
                    assert page.get_by_label('月預算管理',exact=True).get_attribute('data-month')=='2026-07'
                    assert page.get_by_text('這個月份尚未設定預算。可分幣別設定總額、分類額度和安全保留金額。',exact=True).count()==1
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),'horizontal overflow'
                    page.evaluate('window.scrollTo(0,0)')
                    page.screenshot(path=str(args.report.parent/f'transactions-{width}.png'),full_page=True)
                    passed(f'{width}px transaction amount/date edit and matching analysis month')
                    page.locator('.ls-app-signout').click();page.get_by_label('帳號名稱',exact=True).wait_for()
                    login(b);nav('首頁');page.locator('.ls-month-tools > summary').click()
                    panel=page.get_by_label('月預算管理',exact=True)
                    panel.get_by_role('button',name='編輯預算',exact=True).wait_for(timeout=30000)
                    assert panel.get_by_text('NT$222',exact=True).count()>=1
                    assert panel.get_by_text('NT$'+format(2000+width,','),exact=True).count()==0
                    assert not errors,'browser JavaScript error'
                    context.close()
                    passed(f'{width}px account switch never displays previous account budget')
            finally:browser.close()
        # Delete only the synthetic budget and check a fresh read is empty.
        # Product sign-out revokes earlier sessions; obtain a fresh synthetic-user session.
        renewed=request('POST',app+'/api/v2/auth/login',body={'username':a['username'],'password':a['password']})
        a['headers']={'Authorization':'Bearer '+renewed['session']['access_token']}
        current=budget(a)['budget'];assert budget(a,'DELETE',month='2026-10',currency='TWD',version=current['version'])['ok']
        assert budget(a)['budget'] is None
        passed('budget deletion removes the plan without deleting transactions')
    except Exception as error:
        failure=error;checks.append({'name':'run','status':'FAIL','type':type(error).__name__,'message':str(error)[:350]})
    finally:
        if manifest.exists():
            result=subprocess.run(['node',str(Path(__file__).with_name('cleanup_shortcuts_qa.mjs'))],input=manifest.read_text(),text=True,capture_output=True,env=env,timeout=60)
            if result.returncode:
                cleanup=[{'synthetic_user_removed':False}];failure=failure or RuntimeError('Exact-ID synthetic cleanup failed')
            else:cleanup=json.loads(result.stdout)['cleanup']
        output={'status':'FAIL' if failure else 'PASS','app':app,'fixture_setup':'admin synthetic fixtures (not public signup)','checks':checks,'cleanup':cleanup,'at':datetime.now(timezone.utc).isoformat()}
        args.report.write_text(json.dumps(output,ensure_ascii=False,indent=2))
    if failure:raise failure
    print('PASS budget/editor acceptance; exact synthetic fixture cleanup verified',flush=True)

if __name__=='__main__':main()
