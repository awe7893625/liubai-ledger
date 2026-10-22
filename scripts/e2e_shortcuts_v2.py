"""Opt-in public API + mobile/desktop UI QA using only fresh synthetic accounts.
No legacy import or private Ledger access. Environment keys are used only to
remove this run's synthetic Auth users; no SQL or broad database reads.
"""
from __future__ import annotations
import argparse
import json
import os
import re
import secrets
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime, timezone
from dotenv import dotenv_values

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def request(method, url, headers=None, body=None, expected=(200,)):
    req = urllib.request.Request(url, method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"User-Agent":"Mozilla/5.0 LedgerSyntheticQA/2.0", "Content-Type":"application/json", **(headers or {})})
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=35) as r:
            status, raw = r.status, r.read(2_000_000)
    except urllib.error.HTTPError as r:
        status, raw = r.code, r.read(50000)
    data = json.loads(raw) if raw else {}
    if status not in expected:
        raise AssertionError(f"{method} {urllib.parse.urlparse(url).path}: HTTP {status}, expected {expected}")
    return data


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--app-url",required=True)
    p.add_argument("--cleanup-env",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    p.add_argument("--browser",action="store_true")
    args=p.parse_args()
    app=args.app_url.rstrip("/")
    assert app=="https://app.blankspaces.uk", "Use only the authorized public app"
    env=dotenv_values(args.cleanup_env)
    auth_origin=env["SUPABASE_URL"].rstrip("/")
    assert urllib.parse.urlparse(auth_origin).hostname=="vhosvmnhdrzkhmkmptqg.supabase.co"
    anon=env.get("SUPABASE_PUBLISHABLE_KEY") or env.get("SUPABASE_ANON_KEY")
    run=secrets.token_hex(5); users=[]; checks=[]; failure=None
    args.report.parent.mkdir(parents=True,exist_ok=True)
    def passed(name):
        checks.append({"name":name,"status":"PASS"}); print("PASS",name,flush=True)
    def signup(label):
        username="qa_"+label+"_"+run; password="QA!"+secrets.token_urlsafe(20)
        result=request("POST",app+"/api/v2/auth/signup",body={"username":username,"password":password},expected=(201,))
        headers={"Authorization":"Bearer "+result["session"]["access_token"]}
        boot=request("POST",app+"/api/v2/bootstrap",headers,{})
        entry={"id":boot["profile"]["user_id"],"headers":headers,"username":username,"password":password,"bootstrap":boot}
        users.append(entry)
        # Persist only exact synthetic IDs/names for safe recovery if cleanup fails.
        manifest=args.report.parent/"cleanup-manifest.json"
        with manifest.open("w") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump({"run_id":run,"users":[{"id":u["id"],"username":u["username"]} for u in users]},f)
        return entry
    def create_account(user,name,alias):
        return request("POST",app+"/api/v2/accounts",user["headers"],
            {"name":name,"type":"card","card_aliases":[alias],"currency":"TWD"},(201,))["account"]
    try:
        assert request("GET",app+"/api/v2/health")["ok"]
        a,b=signup("a"),signup("b")
        ca=create_account(a,"QA同銀行日常卡","QA Wallet 1111")
        ca2=create_account(a,"QA同銀行旅行卡","QA Wallet 2222")
        cb=create_account(b,"QA別人的卡","QA Wallet 1111")
        cat_a=a["bootstrap"]["categories"][0]["id"]
        cat_b=b["bootstrap"]["categories"][0]["id"]
        passed("public signup/bootstrap and independent card lists")
        request("PATCH",app+"/api/v2/accounts",b["headers"],
                {"id":ca["id"],"name":"NOT ALLOWED","type":"card"},(404,))
        request("POST",app+"/api/v2/accounts",a["headers"],
                {"name":"Alias collision","card_aliases":["QA Wallet 1111"]},(409,))
        request("POST",app+"/api/v2/accounts",a["headers"],
                {"name":"4111 1111 1111 1111"},(400,))
        passed("foreign account edits, overlapping aliases and full card numbers rejected")
        pair=request("POST",app+"/api/v2/pair/start",a["headers"],{},(201,))
        exchange=request("POST",app+"/api/v2/pair/exchange",body={"pair_ticket":pair["pair_ticket"],"device_name":"QA Shortcut v2"},expected=(201,))
        device={"X-Ledger-Device-Token":exchange["device_token"]}
        url=app+"/api/v2/wallet/ingest"
        config=request("GET",url,device)
        assert config["ledger_label"]==a["username"]
        assert ca["id"] in config["accounts"].values() and cb["id"] not in config["accounts"].values()
        assert "transactions" not in config and "balance" not in config
        assert request("POST",url,device,{"dry_run":True})["dry_run"]
        request("GET",app+"/api/v2/accounts",device,expected=(401,))
        request("GET",app+"/api/v2/transactions",device,expected=(401,))
        passed("device config is tenant-scoped; probe does not write; device cannot access user APIs")
        base={"source":"manual","direction":"expense","amount":"123.45","merchant":"QA Manual Lunch",
              "account_id":ca["id"],"category_id":cat_a,"currency":"TWD","note":"synthetic QA",
              "request_id":config["request_id"],"occurred_at":datetime.now(timezone.utc).isoformat(),"user_id":b["id"]}
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:request("POST",url,device,base,(200,201)),range(4)))
        assert len({r["tx_id"] for r in results})==1
        assert sum(not r["duplicate"] for r in results)==1
        assert all(r["amount_minor"]==-12345 and r["receipt"]=="ledger_saved_v2" for r in results)
        passed("four concurrent manual requests yield one correctly signed expense and receipt")
        for change in ({"account_id":cb["id"]},{"category_id":cat_b},{"amount":-5}):
            request("POST",url,device,{**base,**change,"request_id":"reject-"+secrets.token_hex(4)},(400,))
        income=request("POST",url,device,{**base,"request_id":"income-"+run,"direction":"income","amount":"2000"},(201,))
        assert income["amount_minor"]==200000
        passed("manual income positive; foreign account/category and invalid amounts rejected")
        known=request("POST",url,device,{"request_id":"wallet-"+run,"amount":"45","merchant":"QA Coffee","card":"QA Wallet 2222"},(201,))
        assert known["account_match"]=="matched" and not known["needs_review"]
        unknown=request("POST",url,device,{"request_id":"unknown-"+run,"amount":"66","merchant":"QA Shop","card":"QA Unrecognised Card"},(201,))
        assert unknown["needs_review"] and unknown["result"]=="review" and unknown["tx_id"]
        passed("same-issuer cards map exactly; unknown card is saved and explicitly flagged")
        request("POST",app+"/api/v2/devices",a["headers"],{"device_id":exchange["device"]["id"]})
        request("GET",url,device,expected=(401,))
        passed("revoked device cannot fetch config")
        if args.browser:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True)
                try:
                    for width in (390,1280):
                        context=browser.new_context(viewport={"width":width,"height":844})
                        page=context.new_page(); errors=[]
                        page.on("pageerror",lambda e:errors.append(type(e).__name__))
                        page.goto(app+"/connect?tab=settings",wait_until="networkidle",timeout=60000)
                        page.get_by_label("帳號名稱",exact=True).fill(a["username"])
                        page.get_by_label("密碼",exact=True).fill(a["password"])
                        page.locator(".ls-auth-submit").click()
                        page.get_by_role("heading",name="我的信用卡與付款方式",exact=True).wait_for(timeout=30000)
                        panel=page.locator('section[aria-label="付款方式設定"]')
                        panel.get_by_role("button",name="新增",exact=True).click()
                        name=f"QA瀏覽器卡{width}"
                        panel.get_by_label("名稱",exact=True).fill(name)
                        panel.get_by_label("Wallet 別名（選填，一行一個）",exact=True).fill(f"QA Browser {width}")
                        panel.get_by_role("button",name="儲存付款方式",exact=True).click()
                        panel.get_by_text(name,exact=True).wait_for(timeout=30000)
                        assert page.get_by_role("link",name="安裝手動記帳",exact=True).count()==1
                        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "horizontal overflow"
                        assert not errors, "browser JavaScript errors"
                        page.screenshot(path=str(args.report.parent/f"payment-settings-{width}.png"),full_page=True)
                        context.close()
                        passed(f"{width}px UI: sign-in, account creation, manual shortcut link, no overflow/errors")
                finally: browser.close()
    except Exception as error:
        failure=error
        checks.append({"name":"run","status":"FAIL","error":str(error)[:200]})
    finally:
        cleanup=[]
        for u in reversed(users):
            if anon:
                try:
                    request("POST",auth_origin+"/auth/v1/logout?scope=global",{**u["headers"],"apikey":anon},expected=(200,204,401,403))
                except Exception:
                    pass  # Auth deletion + cascading row cleanup is verified below.
        if users:
            try:
                server_env=os.environ.copy()
                for key in ("SUPABASE_URL","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_ROLE_KEY"):
                    if env.get(key): server_env[key]=env[key]
                manifest={"run_id":run,"users":[{"id":u["id"],"username":u["username"]} for u in users]}
                helper=Path(__file__).resolve().with_name("cleanup_shortcuts_qa.mjs")
                result=subprocess.run(["node",str(helper)],input=json.dumps(manifest),text=True,capture_output=True,env=server_env,timeout=60)
                if result.returncode: raise RuntimeError("Server SDK synthetic cleanup failed; use saved exact-ID manifest")
                cleanup=json.loads(result.stdout)["cleanup"]
            except Exception as error:
                cleanup.append({"synthetic_user_removed":False,"error":type(error).__name__}); failure=failure or error
        args.report.write_text(json.dumps({"status":"FAIL" if failure else "PASS","app":app,"checks":checks,"cleanup":cleanup,
            "not_tested":["real iPhone import/run","real Wallet tap","native draft file behaviour"],"at":datetime.now(timezone.utc).isoformat()},ensure_ascii=False,indent=2))
    if failure: raise failure
    print("PASS public shortcut-v2 protocol and UI; native iPhone execution remains unverified",flush=True)

if __name__=="__main__": main()
