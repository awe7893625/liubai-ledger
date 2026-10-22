"""Opt-in authenticated production checks using two fresh synthetic public users.
Does not edit any real account, schema or M4 data; honours signup/login limits.
Never switches to an admin signup path when public signup is rate-limited.
"""
from pathlib import Path
from urllib.parse import urlparse
import argparse, base64, json, os, secrets, subprocess
from datetime import datetime, timezone
from dotenv import dotenv_values
from e2e_shortcuts_v2 import request


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cleanup-env',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args();app='https://app.blankspaces.uk'
    env=dotenv_values(args.cleanup_env);assert urlparse(env['SUPABASE_URL']).hostname=='vhosvmnhdrzkhmkmptqg.supabase.co'
    run=secrets.token_hex(5);users=[];checks=[];cleanup=[];failure=None
    args.report.parent.mkdir(parents=True,exist_ok=True)
    def passed(name):checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
    def signup(label):
        username=f'qa_{label}_{run}';password='QA!'+secrets.token_urlsafe(24)
        result=request('POST',app+'/api/v2/auth/signup',body={'username':username,'password':password},expected=(201,))
        token=result['session']['access_token'];encoded=token.split('.')[1]
        uid=json.loads(base64.urlsafe_b64decode(encoded+'='*(-len(encoded)%4)))['sub']
        entry={'id':uid,'username':username,'password':password,'headers':{'Authorization':'Bearer '+token}}
        users.append(entry)
        manifest=args.report.parent/'cleanup-manifest.json';manifest.write_text(json.dumps({'run_id':run,'users':[{'id':u['id'],'username':u['username']} for u in users]}));manifest.chmod(0o600)
        entry['bootstrap']=request('POST',app+'/api/v2/bootstrap',entry['headers'],{})
        return entry
    try:
        assert request('GET',app+'/api/v2/health')['ok']
        request('GET',app+'/api/v2/categories',expected=(401,))
        a,b=signup('a'),signup('b');passed('public signup and unauthenticated category read denied')
        name='QA Category '+run
        category=request('POST',app+'/api/v2/categories',a['headers'],{'name':name,'user_id':b['id']},(201,))['category']
        assert category['id'] not in [row['id'] for row in request('GET',app+'/api/v2/categories',b['headers'])['categories']]
        request('PATCH',app+'/api/v2/categories',b['headers'],{'id':category['id'],'expected_name':name,'name':'NOT ALLOWED'},(404,))
        request('POST',app+'/api/v2/categories',a['headers'],{'name':name,'id':category['id']},(409,))
        request('DELETE',app+'/api/v2/categories',a['headers'],{'id':category['id']},(405,))
        passed('category owner comes from session; foreign writes, duplicates and deletion rejected')
        body={'amount':'12.50','merchant':'QA Coffee '+run,'category_id':category['id'],'account_id':a['bootstrap']['accounts'][0]['id'],'request_id':'qa-finish-'+run,'occurred_at':'2026-10-22T04:00:00Z'}
        transaction=request('POST',app+'/api/v2/transactions',a['headers'],body,(201,))['transaction']
        assert request('POST',app+'/api/v2/transactions',a['headers'],body)['transaction']['id']==transaction['id']
        updated=request('PATCH',app+'/api/v2/categories',a['headers'],{'id':category['id'],'expected_name':name,'name':'QA Renamed '+run})['category']
        assert updated['id']==category['id']
        request('PATCH',app+'/api/v2/categories',a['headers'],{'id':category['id'],'expected_name':name,'name':'STALE'},(409,))
        boot=request('POST',app+'/api/v2/bootstrap',a['headers'],{})
        assert next(row['name'] for row in boot['categories'] if row['id']==category['id'])=='QA Renamed '+run
        request('POST',app+'/api/v2/transactions',a['headers'],{'amount':'65','merchant':'QA History '+run,'category_id':category['id'],'request_id':'qa-history-finish-'+run,'occurred_at':'2026-09-22T04:00:00Z'},(201,))
        passed('rename persists through bootstrap, IDs stay stable and stale rename cannot overwrite')
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            try:
                context=browser.new_context(viewport={'width':390,'height':844},accept_downloads=True)
                page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(app+'/connect?tab=transactions',wait_until='networkidle',timeout=60000)
                page.get_by_label('帳號名稱',exact=True).fill(a['username']);page.get_by_label('密碼',exact=True).fill(a['password']);page.locator('.ls-auth-submit').click()
                page.get_by_role('heading',name='交易紀錄',exact=True).wait_for(timeout=30000)
                page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden',timeout=30000)
                page.get_by_text('QA Coffee '+run,exact=True).wait_for(timeout=30000)
                assert page.locator('.lf-day-groups > section').count()==2
                page.get_by_label('搜尋交易').fill('QA Coffee '+run)
                with page.expect_download() as download:page.get_by_role('button',name='匯出 CSV',exact=True).click()
                csv=Path(download.value.path()).read_text(encoding='utf-8-sig');assert 'QA Coffee '+run in csv and '-12.50' in csv and 'QA History '+run not in csv
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                boxes=page.evaluate('''() => {const b=s=>document.querySelector(s).getBoundingClientRect();return {main:b('.ls-app-main').bottom,nav:b('.ls-app-bottom-nav').top,vh:visualViewport.height,bottom:b('.ls-app-bottom-nav').bottom}}''')
                assert boxes['main']<=boxes['nav']+1 and boxes['bottom']<=boxes['vh']+1
                passed('real hosted login, daily groups, filtered CSV and non-overlapping 390px navigation')
                nav=page.locator('.ls-app-bottom-nav');nav.get_by_role('button',name='設定',exact=True).click();page.get_by_role('button',name='付款與分類',exact=True).click()
                panel=page.get_by_role('region',name='分類管理',exact=True)
                panel.get_by_label('分類名稱',exact=True).fill('QA Browser '+run);panel.get_by_role('button',name='新增分類',exact=True).click();panel.get_by_role('button',name='修改分類 QA Browser '+run,exact=True).wait_for(timeout=30000)
                current=request('GET',app+'/api/v2/categories',a['headers'])['categories'];assert any(row['name']=='QA Browser '+run for row in current)
                page.get_by_role('button',name='一般設定',exact=True).click();page.get_by_label('顯示模式').select_option('dark')
                page.get_by_label('顯示暱稱').fill('QA Local '+run);page.get_by_role('button',name='儲存暱稱',exact=True).click()
                page.reload(wait_until='networkidle');page.get_by_role('heading',name='帳號與設定',exact=True).wait_for(timeout=30000)
                page.wait_for_function('document.querySelector(".ls-app-root")?.dataset.theme === "dark"')
                assert page.get_by_label('顯示暱稱').input_value()=='QA Local '+run
                page.screenshot(path=str(args.report.parent/'production-settings-390.png'))
                passed('real category form persists and local appearance survives reload')
                nav.get_by_role('button',name='記一筆',exact=True).click();save=page.get_by_role('button',name='儲存交易',exact=True);save.scroll_into_view_if_needed()
                box=save.bounding_box();main=page.locator('.ls-app-main').bounding_box();assert box['y']>=main['y'] and box['y']+box['height']<=main['y']+main['height']+1
                page.screenshot(path=str(args.report.parent/'production-capture-390.png'))
                nav.get_by_role('button',name='探索',exact=True).click();page.get_by_label('探索月份',exact=True).select_option('2026-10')
                page.get_by_label('帳務問題',exact=True).fill('2026-10花多少？');page.locator('.lx-input-row').first.get_by_role('button',name='查詢',exact=True).click();page.locator('.lx-answer').wait_for()
                assert page.locator('.lx-metrics').get_by_text('NT$12.5',exact=True).count()+page.locator('.lx-metrics').get_by_text('NT$12.50',exact=True).count()>=1
                page.locator('.ls-app-signout').click();page.get_by_label('帳號名稱',exact=True).wait_for();assert page.locator('.lx-answer').count()==0
                page.get_by_label('帳號名稱',exact=True).fill(b['username']);page.get_by_label('密碼',exact=True).fill(b['password']);page.locator('.ls-auth-submit').click();page.locator('.ls-app-root').wait_for(timeout=30000)
                nav.get_by_role('button',name='交易',exact=True).click();page.get_by_text('還沒有交易',exact=True).wait_for(timeout=30000)
                assert page.get_by_text('QA Coffee '+run,exact=True).count()==0
                nav.get_by_role('button',name='設定',exact=True).click();page.get_by_role('button',name='一般設定',exact=True).click();assert page.get_by_label('顯示暱稱').input_value()!='QA Local '+run
                assert not errors,errors
                passed('save action remains reachable; exploration regression and account switch isolation pass')
                context.close()
            finally:browser.close()
    except Exception as error:
        failure=error;checks.append({'name':'run','status':'FAIL','type':type(error).__name__,'message':str(error)[:500]})
    finally:
        if users:
            environment=os.environ.copy()
            for key in ('SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'):
                if env.get(key):environment[key]=env[key]
            manifest={'run_id':run,'users':[{'id':u['id'],'username':u['username']} for u in users]}
            result=subprocess.run(['node',str(Path(__file__).with_name('cleanup_shortcuts_qa.mjs'))],input=json.dumps(manifest),text=True,capture_output=True,env=environment,timeout=60)
            if result.returncode:
                cleanup=[{'status':'FAILED','manifest_retained':True}];failure=failure or RuntimeError('Exact-ID synthetic cleanup failed')
            else:cleanup=json.loads(result.stdout)['cleanup']
        report={'status':'FAIL' if failure else 'PASS','scope':'public brand domain; two synthetic users only','checks':checks,'cleanup':cleanup,'physical_iPhone':False,'at':datetime.now(timezone.utc).isoformat()}
        args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    if failure:raise failure
    print('PASS hosted acceptance; synthetic data removed',flush=True)
if __name__=='__main__':main()
