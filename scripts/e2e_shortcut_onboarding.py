"""Synthetic end-to-end checks for manual-first Shortcut onboarding.
Uses public APIs and ephemeral browser contexts, not real-user data or sessions.
Native iPhone execution/Wallet NFC is explicitly not simulated as acceptance.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
from urllib.parse import urlparse
from dotenv import dotenv_values
from e2e_shortcuts_v2 import request


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-url',required=True)
    parser.add_argument('--cleanup-env',type=Path,required=True)
    parser.add_argument('--report',type=Path,required=True)
    parser.add_argument('--local-runtime',action='store_true')
    args=parser.parse_args();app=args.app_url.rstrip('/')
    assert app == ('http://127.0.0.1:5194' if args.local_runtime else 'https://app.blankspaces.uk')
    env=dotenv_values(args.cleanup_env)
    assert urlparse(env['SUPABASE_URL']).hostname=='vhosvmnhdrzkhmkmptqg.supabase.co'
    args.report.parent.mkdir(parents=True,exist_ok=True)
    run=secrets.token_hex(5);users=[];checks=[];failure=None;cleanup=[]
    def passed(name):
        checks.append({'name':name,'status':'PASS'});print('PASS',name,flush=True)
    def signup(label):
        username='qa_'+label+'_'+run;password='QA!'+secrets.token_urlsafe(20)
        response=request('POST',app+'/api/v2/auth/signup',body={'username':username,'password':password},expected=(201,))
        token=response['session']['access_token'];part=token.split('.')[1]
        uid=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))['sub']
        user={'id':uid,'username':username,'password':password,'headers':{'Authorization':'Bearer '+token}}
        users.append(user)
        manifest=args.report.parent/'cleanup-manifest.json'
        manifest.write_text(json.dumps({'run_id':run,'users':[{'id':u['id'],'username':u['username']} for u in users]}));manifest.chmod(0o600)
        user['bootstrap']=request('POST',app+'/api/v2/bootstrap',user['headers'],{})
        return user
    def readiness(user):
        return request('GET',app+'/api/v2/devices?onboarding=1',user['headers'])['onboarding']
    def device(user,label):
        pair=request('POST',app+'/api/v2/pair/start',user['headers'],{},(201,))
        data=request('POST',app+'/api/v2/pair/exchange',body={'pair_ticket':pair['pair_ticket'],'device_name':label},expected=(201,))
        return {'id':data['device']['id'],'headers':{'X-Ledger-Device-Token':data['device_token']}}
    try:
        request('GET',app+'/api/v2/devices?onboarding=1',expected=(401,))
        a,b=signup('a'),signup('b')
        assert readiness(a)['devices']==[]
        first=device(a,'QA First iPhone');second=device(a,'QA Second iPhone')
        browser_tx=request('POST',app+'/api/v2/transactions',a['headers'],{'amount':5,'merchant':'QA browser entry','request_id':'web-'+run,'source':'manual','device_id':first['id']},(201,))
        assert browser_tx['transaction']['source']=='manual'
        probe=request('POST',app+'/api/v2/wallet/ingest',first['headers'],{'dry_run':True})
        assert probe['dry_run']
        assert all(not p['can_configure_wallet'] for p in readiness(a)['devices'])
        passed('pairing, browser entry and dry-run do not unlock manual Shortcut proof')
        request('POST',app+'/api/v2/wallet/ingest',first['headers'],{'source':'manual','amount':0,'merchant':'QA invalid','account_id':a['bootstrap']['accounts'][0]['id'],'request_id':'bad-'+run},(400,))
        assert all(not p['can_configure_wallet'] for p in readiness(a)['devices'])
        body={'source':'manual','direction':'expense','amount':'1','merchant':'QA Shortcut test '+run,
              'request_id':'manual-'+run,'account_id':a['bootstrap']['accounts'][0]['id'],
              'category_id':a['bootstrap']['categories'][0]['id'],'currency':'TWD'}
        receipt=request('POST',app+'/api/v2/wallet/ingest',first['headers'],body,(201,))
        assert receipt['receipt']=='ledger_saved_v2' and receipt['status']=='confirmed'
        progress={p['device_id']:p for p in readiness(a)['devices']}
        assert progress[first['id']]['stage']=='wallet_setup_ready'
        assert progress[first['id']]['can_configure_wallet']
        assert not progress[second['id']]['can_configure_wallet']
        assert readiness(b)['devices']==[]
        foreign=request('GET',app+'/api/v2/devices?onboarding=1&user_id='+a['id'],b['headers'])
        assert foreign['onboarding']['devices']==[]
        passed('confirmed manual receipt unlocks only the matching device and owner')
        request('DELETE',app+'/api/v2/transactions',a['headers'],{'id':receipt['tx_id']})
        progress={p['device_id']:p for p in readiness(a)['devices']}
        assert progress[first['id']]['can_configure_wallet'] and progress[first['id']]['manual_receipt']['transaction_id'] is None
        passed('deleting a real test transaction preserves completed device verification')

        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True)
            try:
                for width in (390,1280):
                    context=browser.new_context(viewport={'width':width,'height':844})
                    page=context.new_page();errors=[]
                    page.on('pageerror',lambda err:errors.append(type(err).__name__))
                    page.goto(app+'/connect?tab=settings',wait_until='networkidle',timeout=60000)
                    page.get_by_label('帳號名稱',exact=True).fill(a['username'])
                    page.get_by_label('密碼',exact=True).fill(a['password'])
                    page.locator('.ls-auth-submit').click()
                    panel=page.get_by_role('region',name='捷徑與 Apple Pay 設定流程',exact=True)
                    panel.wait_for(timeout=30000)
                    select=panel.get_by_label('正在設定的裝置',exact=True)
                    select.wait_for(timeout=30000)
                    select.select_option(second['id'])
                    assert panel.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
                    assert not panel.get_by_role('button',name='完成上一個步驟後繼續',exact=True).is_enabled()
                    select.select_option(first['id'])
                    panel.get_by_text('手動捷徑入帳已確認',exact=False).wait_for()
                    panel.get_by_role('link',name='安裝自動記帳',exact=True).wait_for()
                    assert panel.get_by_role('link',name='開啟手動捷徑',exact=True).get_attribute('href').startswith('shortcuts://')
                    assert page.get_by_role('link',name='安裝手動記帳',exact=True).count()==1
                    page.evaluate('window.scrollTo(0,0)')
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                    page.screenshot(path=str(args.report.parent/f'setup-{width}.png'),full_page=True)
                    passed(f'{width}px manual-first guide unlocks only selected verified device')
                    def offline(route):route.abort()
                    page.route('**/api/v2/devices?onboarding=1',offline)
                    panel.get_by_role('button',name='更新測試結果',exact=True).click()
                    panel.get_by_role('alert').wait_for(timeout=30000)
                    assert panel.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
                    page.unroute('**/api/v2/devices?onboarding=1',offline)
                    panel.get_by_role('button',name='更新測試結果',exact=True).click()
                    panel.get_by_role('link',name='安裝自動記帳',exact=True).wait_for(timeout=30000)
                    page.locator('.ls-app-signout').click()
                    page.get_by_label('帳號名稱',exact=True).wait_for()
                    page.get_by_label('帳號名稱',exact=True).fill(b['username'])
                    page.get_by_label('密碼',exact=True).fill(b['password'])
                    page.locator('.ls-auth-submit').click()
                    page.get_by_role('region',name='捷徑與 Apple Pay 設定流程',exact=True).wait_for(timeout=30000)
                    page.get_by_role('button',name='先安裝並配對',exact=True).wait_for(timeout=30000)
                    assert page.get_by_label('正在設定的裝置',exact=True).count()==0
                    assert page.get_by_role('link',name='安裝自動記帳',exact=True).count()==0
                    assert not errors,'Browser JavaScript errors'
                    context.close()
                    passed(f'{width}px stale/error state cannot claim success; next account sees no prior proof')
            finally:browser.close()
        config=request('GET',app+'/api/v2/wallet/ingest',first['headers'])
        pending=request('POST',app+'/api/v2/wallet/ingest',first['headers'],{'source':'apple_pay','request_id':'wallet-review-'+run,'merchant':'QA unknown','card':'QA unknown card','amount':3},(201,))
        assert pending['needs_review']
        assert next(p for p in readiness(a)['devices'] if p['device_id']==first['id'])['stage']=='wallet_received_review'
        card=request('POST',app+'/api/v2/accounts',a['headers'],{'name':'QA daily card','type':'card','card_aliases':['QA Wallet '+run]},(201,))['account']
        wallet=request('POST',app+'/api/v2/wallet/ingest',first['headers'],{'source':'apple_pay','request_id':'wallet-ok-'+run,'merchant':'QA coffee','card':'QA Wallet '+run,'amount':4},(201,))
        assert wallet['account_match']=='matched' and not wallet['needs_review']
        latest=next(p for p in readiness(a)['devices'] if p['device_id']==first['id'])
        assert latest['stage']=='wallet_receipt_received' and latest['ios_trigger_attested'] is False
        passed('Wallet pending and saved receipts distinguished; no false native-trigger attestation')
        request('POST',app+'/api/v2/devices',a['headers'],{'device_id':first['id']})
        remaining=readiness(a)['devices']
        assert len(remaining)==1 and remaining[0]['device_id']==second['id'] and not remaining[0]['can_configure_wallet']
        request('GET',app+'/api/v2/wallet/ingest',first['headers'],expected=(401,))
        passed('revocation removes old success and does not unlock a different phone')
        if not args.local_runtime:
            from urllib.request import Request,urlopen
            import hashlib
            for filename in ('Liubai-Manual.shortcut','Liubai-Cloud.shortcut'):
                with urlopen(Request(app+'/shortcuts/'+filename,headers={'User-Agent':'Mozilla/5.0 LedgerOnboardingQA/1.0'}),timeout=30) as res:remote=res.read(2_000_000)
                local=Path(__file__).resolve().parents[1]/'frontend/public/shortcuts'/filename
                assert hashlib.sha256(remote).digest()==hashlib.sha256(local.read_bytes()).digest()
            passed('published signed v3 Shortcut files match release hashes')
    except Exception as exc:
        failure=exc;checks.append({'name':'run','status':'FAIL','type':type(exc).__name__,'message':str(exc)[:350]})
    finally:
        if users:
            try:
                environment=os.environ.copy()
                for key in ('SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY'):
                    if env.get(key):environment[key]=env[key]
                manifest={'run_id':run,'users':[{'id':u['id'],'username':u['username']} for u in users]}
                result=subprocess.run(['node',str(Path(__file__).with_name('cleanup_shortcuts_qa.mjs'))],input=json.dumps(manifest),text=True,capture_output=True,env=environment,timeout=60)
                if result.returncode:raise RuntimeError('Synthetic cleanup failed; exact run manifest retained')
                cleanup=json.loads(result.stdout)['cleanup']
            except Exception as exc:
                failure=failure or exc;cleanup.append({'synthetic_user_removed':False,'type':type(exc).__name__})
        args.report.write_text(json.dumps({'status':'FAIL' if failure else 'PASS','app':app,'runtime':'local_with_hosted_db' if args.local_runtime else 'production',
            'checks':checks,'cleanup':cleanup,'not_tested':['physical iPhone import and execution','real NFC Apple Pay trigger'],
            'at':datetime.now(timezone.utc).isoformat()},ensure_ascii=False,indent=2))
    if failure:raise failure
    print('PASS manual-first onboarding; exact synthetic cleanup completed',flush=True)

if __name__=='__main__':main()
