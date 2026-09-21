"""Capture actual Ledger screens from a disposable, entirely synthetic database."""
from __future__ import annotations
import io, os, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from datetime import date, timedelta
ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'.qa';QA.mkdir(exist_ok=True)
OUT=ROOT/'frontend/public/screens';OUT.mkdir(parents=True,exist_ok=True)
from PIL import Image
from playwright.sync_api import sync_playwright

def ready(url):
    for _ in range(100):
        try:
            with urllib.request.urlopen(url,timeout=1) as r:
                if r.status==200:return
        except Exception:time.sleep(.2)
    raise RuntimeError('Preview did not start: '+url)

with tempfile.TemporaryDirectory(prefix='ledger-synthetic-') as tmp:
    db=str(Path(tmp)/'showcase.db')
    os.environ['DATABASE_URL']='sqlite:///'+db
    sys.path.insert(0,str(ROOT/'backend'))
    from app.db import init_db,tx,reset_conn
    init_db()
    today=date.today();month=today.strftime('%Y-%m')
    with tx() as c:
        c.execute("INSERT INTO funding_accounts(id,user_id,type,nickname,currency,metadata) VALUES('demo-card','local','credit_card','日常卡（示範）','TWD','{}')")
        c.execute("INSERT INTO budgets(id,user_id,period_month,total_limit_minor,safety_buffer_minor) VALUES(?,?,?,?,?)",('demo-budget','local',month,1200000,0))
        samples=[('日常咖啡',120,'c_food'),('街角午餐',180,'c_food'),('城市捷運',45,'c_transport'),('週末書店',420,'c_education'),('新鮮蔬果',320,'c_food'),('生活小物',250,'c_shopping'),('週末電影',300,'c_fun'),('早餐時光',65,'c_food')]
        for i,(name,amount,cat) in enumerate(samples):
            d=(today-timedelta(days=i%5)).isoformat()
            c.execute("INSERT INTO transactions(id,user_id,funding_account_id,amount,currency,date,occurred_at,description,merchant,merchant_normalized,category_id,source,status,kind,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(f'demo-{i}','local','demo-card',-amount*100,'TWD',d,f'{d}T{9+i:02d}:41:00+08:00',name,name,name,cat,'manual','confirmed','expense','虛構示範資料'))
    reset_conn()
    env=dict(os.environ,DATABASE_URL='sqlite:///'+db,CORS_ORIGINS='http://127.0.0.1:14182',VITE_PUBLIC_DOCS='0',VITE_API_BASE='http://127.0.0.1:18182/api',LEDGER_OLLAMA_MODEL='',LEDGER_OLLAMA_VISION_MODEL='',OPENROUTER_API_KEY='')
    with (QA/'capture-runtime.log').open('w') as log:
        back=subprocess.Popen([sys.executable,'-m','uvicorn','app.main:app','--app-dir',str(ROOT/'backend'),'--host','127.0.0.1','--port','18182'],cwd=ROOT,env=env,stdout=log,stderr=log)
        front=subprocess.Popen([str(ROOT/'frontend/node_modules/.bin/vite'),'--host','127.0.0.1','--port','14182','--strictPort'],cwd=ROOT/'frontend',env=env,stdout=log,stderr=log)
        try:
            ready('http://127.0.0.1:18182/api/health');ready('http://127.0.0.1:14182')
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
                page=browser.new_page(viewport={'width':1200,'height':900},device_scale_factor=1,reduced_motion='reduce')
                for name,route,text in [('overview','dashboard','今天還能花多少'),('transactions','ledger','日常咖啡'),('capture','capture','金額')]:
                    page.goto('http://127.0.0.1:14182/'+route,wait_until='networkidle')
                    page.get_by_text(text,exact=False).first.wait_for(timeout=15000)
                    page.wait_for_timeout(500)
                    assert page.locator('body').inner_text().find('載入失敗')==-1
                    image=Image.open(io.BytesIO(page.screenshot())).convert('RGB')
                    image.save(OUT/(name+'.webp'),'WEBP',quality=88,method=5)
                    print('PASS actual app screenshot',name,image.size,flush=True)
                browser.close()
        finally:
            for child in (front,back):
                child.terminate()
                try:child.wait(timeout=10)
                except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
print('PASS disposable database removed; no private ledger was opened')
