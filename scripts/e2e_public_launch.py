"""Opt-in release QA using fresh synthetic tenants only; deletes exact created IDs.
Never accesses, edits or screenshots real-user financial data. Supports local API
runtime + hosted DB (pre-release) and the authorized brand-domain production app.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import secrets
import subprocess
from urllib.parse import urlparse
from dotenv import dotenv_values
from e2e_shortcuts_v2 import request


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--app-url', required=True)
    ap.add_argument('--cleanup-env', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    ap.add_argument('--local-runtime', action='store_true')
    args=ap.parse_args(); app=args.app_url.rstrip('/')
    if args.local_runtime:
        assert app == 'http://127.0.0.1:5194'
    else:
        assert app == 'https://app.blankspaces.uk'
    env=dotenv_values(args.cleanup_env)
    assert urlparse(env['SUPABASE_URL']).hostname=='vhosvmnhdrzkhmkmptqg.supabase.co'
    run=secrets.token_hex(5); users=[]; checks=[]; failure=None; cleanup=[]
    args.report.parent.mkdir(parents=True,exist_ok=True)
    def passed(name):
        checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
    def create_user(label):
        username='qa_'+label+'_'+run;password='QA!'+secrets.token_urlsafe(22)
        created=request('POST',app+'/api/v2/auth/signup',body={'username':username,'password':password},expected=(201,))
        h={'Authorization':'Bearer '+created['session']['access_token']}
        # Record cleanup identity before bootstrap; even a later failure is cleaned.
        token=created['session']['access_token'].split('.')[1]
        import base64
        uid=json.loads(base64.urlsafe_b64decode(token+'='*(-len(token)%4)))['sub']
        entry={'id':uid,'username':username,'password':password,'headers':h};users.append(entry)
        manifest=args.report.parent/'cleanup-manifest.json'
        manifest.write_text(json.dumps({'run_id':run,'users':[{'id':u['id'],'username':u['username']} for u in users]}));manifest.chmod(0o600)
        entry['bootstrap']=request('POST',app+'/api/v2/bootstrap',h,{})
        assert entry['bootstrap']['profile']['user_id']==uid
        return entry
    def post_tx(user, amount, merchant, **kw):
        return request('POST',app+'/api/v2/transactions',user['headers'],{'amount':amount,'merchant':merchant,**kw},(200,201))
    try:
        assert request('GET',app+'/api/v2/health')['ok']
        request('GET',app+'/api/v2/accounts',expected=(401,))
        a,b=create_user('launch_a'),create_user('launch_b')
        passed('public signup, bootstrap and unauthenticated access denial')
        payload={'amount':'123.45','merchant':'QA Concurrent '+run,'request_id':'qa-concurrent-'+run,'user_id':b['id']}
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:request('POST',app+'/api/v2/transactions',a['headers'],payload,(200,201)),range(4)))
        assert len({r['transaction']['id'] for r in results})==1
        assert sum(not r['duplicate'] for r in results)==1
        txid=results[0]['transaction']['id']
        request('PATCH',app+'/api/v2/transactions',b['headers'],{'id':txid,'merchant':'NOT ALLOWED'},(404,))
        request('DELETE',app+'/api/v2/transactions',b['headers'],{'id':txid},(404,))
        request('POST',app+'/api/v2/transactions',a['headers'],{'amount':1e100,'merchant':'QA invalid amount'},(400,))
        passed('concurrent web saves deduplicate; foreign mutations and unsafe amounts denied')
        history='QA History '+run
        post_tx(a,'55.50',history,occurred_at='2026-07-03T04:00:00Z',request_id='qa-history-'+run)
        income=post_tx(a,'2000','QA Income '+run,direction='income',request_id='qa-income-'+run)
        assert income['transaction']['amount_minor']==200000
        passed('historical purchase dates and income are accepted correctly')
        card=request('POST',app+'/api/v2/accounts',a['headers'],{'name':'QA Release Card '+run,'type':'card','card_aliases':['QA Wallet '+run],'currency':'TWD'},(201,))['account']
        pair=request('POST',app+'/api/v2/pair/start',a['headers'],{},(201,))
        paired=request('POST',app+'/api/v2/pair/exchange',body={'pair_ticket':pair['pair_ticket'],'device_name':'QA Release Device'},expected=(201,))
        device={'X-Ledger-Device-Token':paired['device_token']}
        config=request('GET',app+'/api/v2/wallet/ingest',device)
        assert card['id'] in config['accounts'].values() and 'transactions' not in config
        assert request('POST',app+'/api/v2/wallet/ingest',device,{'dry_run':True})['dry_run']
        captured=request('POST',app+'/api/v2/wallet/ingest',device,{'source':'manual','direction':'expense','amount':'17','merchant':'QA Shortcut '+run,'account_id':card['id'],'category_id':a['bootstrap']['categories'][0]['id'],'request_id':config['request_id'],'currency':'TWD'},(201,))
        assert captured['receipt']=='ledger_saved_v2' and captured['tx_id'] and captured['amount_minor']==-1700
        request('POST',app+'/api/v2/devices',a['headers'],{'device_id':paired['device']['id']})
        request('GET',app+'/api/v2/wallet/ingest',device,expected=(401,))
        passed('custom card, device pairing, no-write probe, manual shortcut receipt and revoke')
        if not args.local_runtime:
            import hashlib
            from urllib.request import Request,urlopen
            for artifact in ('Liubai-Cloud.shortcut','Liubai-Manual.shortcut'):
                with urlopen(Request(app+'/shortcuts/'+artifact,headers={'User-Agent':'Mozilla/5.0 LedgerReleaseQA/1.0'}),timeout=30) as response:
                    remote=response.read(2_000_000)
                local=Path(__file__).resolve().parents[1]/'frontend/public/shortcuts'/artifact
                assert hashlib.sha256(remote).digest()==hashlib.sha256(local.read_bytes()).digest()
            passed('both public signed Shortcut downloads match release hashes')
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            try:
                for width in (390,1280):
                    context=browser.new_context(viewport={'width':width,'height':844},accept_downloads=True)
                    page=context.new_page();errors=[]
                    page.on('pageerror',lambda exc:errors.append(type(exc).__name__))
                    page.goto(app+'/connect?tab=transactions',wait_until='networkidle',timeout=60000)
                    if not args.local_runtime:
                        page.locator('.ls-google-render iframe').wait_for(timeout=30000)
                    def login(user):
                        page.get_by_label('帳號名稱',exact=True).fill(user['username'])
                        page.get_by_label('密碼',exact=True).fill(user['password'])
                        page.locator('.ls-auth-submit').click()
                        page.locator('.ls-app-root').wait_for(timeout=30000)
                        page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden',timeout=30000)
                    def nav(label):
                        selector='.ls-app-bottom-nav' if width<720 else '.ls-app-desktop-nav'
                        page.locator(selector).get_by_role('button',name=label,exact=True).click()
                    login(a)
                    page.get_by_role('heading',name='交易紀錄',exact=True).wait_for(timeout=30000)
                    page.get_by_label('交易月份',exact=True).select_option('2026-07')
                    page.get_by_text(history,exact=True).wait_for()
                    with page.expect_download() as download_info:
                        page.get_by_role('button',name='匯出 CSV',exact=True).click()
                    downloaded=Path(download_info.value.path()).read_text(encoding='utf-8-sig')
                    assert history in downloaded and '-55.50' in downloaded and 'QA Income' not in downloaded
                    page.get_by_label('搜尋交易',exact=True).fill('NO MATCH '+run)
                    page.get_by_text('沒有符合的交易',exact=True).wait_for()
                    page.get_by_label('搜尋交易',exact=True).fill('')
                    passed(f'{width}px historical filtering, search and exact filtered CSV export')
                    nav('記一筆')
                    marker=f'QA Retry {width} {run}'
                    page.get_by_label('金額',exact=True).fill('37')
                    page.get_by_label('商家 / 項目',exact=True).fill(marker)
                    seen=[]
                    def drop_first_response(route):
                        if route.request.method!='POST':route.continue_();return
                        body=route.request.post_data_json
                        if body.get('merchant')!=marker:route.continue_();return
                        seen.append(body['request_id'])
                        if len(seen)==1:
                            response=route.fetch()
                            assert response.status in (200,201)
                            route.abort() # Simulate lost acknowledgement AFTER database commit.
                        else:route.continue_()
                    page.route('**/api/v2/transactions',drop_first_response)
                    page.get_by_role('button',name='儲存交易',exact=True).click()
                    page.locator('.ls-app-toast').filter(has_text='尚未確認').wait_for(timeout=30000)
                    page.get_by_role('button',name='儲存交易',exact=True).click()
                    page.get_by_role('heading',name='我的帳本',exact=True).wait_for(timeout=30000)
                    page.get_by_text(marker,exact=True).wait_for(timeout=30000)
                    assert len(seen)==2 and seen[0]==seen[1]
                    assert page.locator('.ls-app-transaction-row').filter(has_text=marker).count()==1
                    page.unroute('**/api/v2/transactions',drop_first_response)
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=str(args.report.parent/f'home-{width}.png'),full_page=True)
                    passed(f'{width}px lost POST acknowledgement retries same ID without duplicate')
                    nav('交易');page.get_by_label('交易月份',exact=True).select_option('')
                    row=page.locator('.ls-app-transaction-row').filter(has_text=marker)
                    page.once('dialog',lambda dialog:dialog.dismiss())
                    row.get_by_role('button',name='刪除 '+marker,exact=True).click()
                    assert row.count()==1
                    # A read failure must not masquerade as an empty ledger.
                    def offline(route):route.abort()
                    page.route('**/rest/v1/ledger_transactions?*',offline)
                    page.get_by_role('button',name='重新整理',exact=True).click()
                    page.get_by_role('alert').filter(has_text='帳本尚未完整更新').wait_for(timeout=30000)
                    assert page.get_by_text('還沒有交易',exact=True).count()==0
                    assert not page.get_by_role('button',name='匯出 CSV',exact=True).is_enabled()
                    page.unroute('**/rest/v1/ledger_transactions?*',offline)
                    page.get_by_role('button',name='重試載入',exact=True).click()
                    page.get_by_role('alert').wait_for(state='hidden',timeout=30000)
                    page.locator('.ls-load-state',has_text='正在同步帳本').wait_for(state='hidden',timeout=30000)
                    page.get_by_text(marker,exact=True).wait_for()
                    passed(f'{width}px delete cancellation and network-error recovery preserve ledger')
                    nav('設定');page.get_by_role('heading',name='我的信用卡與付款方式',exact=True).wait_for()
                    assert page.get_by_role('link',name='安裝手動記帳',exact=True).count()==1
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=str(args.report.parent/f'settings-{width}.png'),full_page=True)
                    page.locator('.ls-app-signout').click()
                    page.get_by_label('帳號名稱',exact=True).wait_for()
                    login(b);nav('交易')
                    page.get_by_text('還沒有交易',exact=True).wait_for(timeout=30000)
                    assert page.get_by_text(marker,exact=True).count()==0
                    assert page.get_by_text(history,exact=True).count()==0
                    assert not errors, 'JavaScript errors detected'
                    context.close()
                    passed(f'{width}px account switch clears prior tenant, settings and layout pass')
            finally:browser.close()
    except Exception as error:
        failure=error;checks.append({'name':'run','status':'FAIL','error_type':type(error).__name__,'message':str(error)[:350]})
    finally:
        if users:
            try:
                environment=os.environ.copy()
                for key in ('SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'):
                    if env.get(key):environment[key]=env[key]
                manifest={'run_id':run,'users':[{'id':u['id'],'username':u['username']} for u in users]}
                helper=Path(__file__).with_name('cleanup_shortcuts_qa.mjs')
                result=subprocess.run(['node',str(helper)],input=json.dumps(manifest),text=True,capture_output=True,env=environment,timeout=60)
                if result.returncode:raise RuntimeError('Exact synthetic cleanup failed; retain manifest for authorized recovery')
                cleanup=json.loads(result.stdout)['cleanup']
            except Exception as error:
                failure=failure or error;cleanup.append({'synthetic_user_removed':False,'error_type':type(error).__name__})
        report={'status':'FAIL' if failure else 'PASS','runtime':'local_with_hosted_db' if args.local_runtime else 'production',
            'app':app,'checks':checks,'cleanup':cleanup,'not_tested':['physical iPhone Shortcut runtime','real Apple Pay tap'],
            'at':datetime.now(timezone.utc).isoformat()}
        args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    if failure:raise failure
    print('PASS release QA; synthetic accounts cleaned',flush=True)

if __name__=='__main__':main()
