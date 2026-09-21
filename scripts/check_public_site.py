"""Browser acceptance tests for the public site. No real account or transaction data."""
from __future__ import annotations
import functools,hashlib,http.server,json,threading,io,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
QA=ROOT/'.qa';QA.mkdir(exist_ok=True)
DIST=ROOT/'frontend/dist'
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
    def do_GET(self):
        if self.path.split('?')[0].startswith('/api'):
            self.send_error(404);return
        if self.path.split('?')[0] in ['/setup','/setup/']:self.path='/index.html'
        super().do_GET()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(DIST)))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
base=f'http://127.0.0.1:{server.server_port}'
results=[]
def record(name,detail='PASS'):
    results.append(dict(test=name,result=detail));print(name,detail,flush=True)
try:
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
        for width,height in [(320,844),(375,844),(390,844),(430,932),(768,1024),(1440,1000)]:
            ctx=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,reduced_motion='reduce',color_scheme='dark')
            external=[];api_calls=[];errors=[]
            def network(route):
                u=route.request.url
                if not u.startswith(base):external.append(u);route.abort()
                else:
                    if '/api/' in u:api_calls.append(u)
                    route.continue_()
            ctx.route('**/*',network)
            page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base,wait_until='networkidle')
            page.locator('h1').wait_for(timeout=15000)
            assert '生活自動成帳' in page.locator('h1').inner_text()
            assert page.locator('.ledger-site').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(243, 239, 230)'
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), f'Horizontal overflow at {width}'
            assert not page.locator('input[type=password]').count()
            for section in ['preview','install','shortcuts','automation','payload','faq']:
                assert page.locator('#'+section).count()==1
                page.locator('#'+section).scroll_into_view_if_needed()
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),f'Overflow {width} {section}'
            for image in page.locator('.ls-screen-image img').all():
                image.scroll_into_view_if_needed();image.evaluate('(el)=>el.loading="eager"')
                image.evaluate('(el)=>el.decode()')
                assert image.evaluate('(el)=>el.naturalWidth')==1200
            for a in page.locator('a[href^="#"]').all():
                href=a.get_attribute('href')
                if href and href!='#':assert page.locator(href).count(),href
            page.evaluate('window.scrollTo(0,0)');page.wait_for_timeout(150)
            page.screenshot(path=str(QA/f'site-{width}.png'),full_page=False)
            if width in (390,1440):
                full=page.screenshot(full_page=True)
                (QA/f'site-full-{width}.png').write_bytes(full)
                image=Image.open(io.BytesIO(full)).convert('RGB')
                image.save(QA/f'site-full-{width}.webp','WEBP',quality=82)
            page.get_by_role('button',name='模擬刷卡').click()
            assert page.locator('.ls-demo-row').filter(has_text='示範感應交易').count()==1
            page.get_by_role('button',name='重設示範').click()
            assert page.locator('.ls-demo-row').filter(has_text='示範感應交易').count()==0
            page.locator('.ls-screen-card').first.click();assert page.locator('dialog').is_visible()
            page.keyboard.press('Escape');assert not page.locator('dialog').is_visible()
            for i in range(4):
                page.locator(f'#auto-tab-{i}').click();assert page.locator(f'#auto-tab-{i}').get_attribute('aria-selected')=='true'
            field=page.locator('#ls-server-url')
            for bad in ['http://ledger.example.test','https://u:pw@ledger.example.test','https://ledger.example.test/?token=test','https://localhost']:
                field.fill(bad);assert field.get_attribute('aria-invalid')=='true'
            field.fill('https://my-ledger.example.test')
            assert field.get_attribute('aria-invalid')=='false'
            assert page.locator('.ls-endpoint code').inner_text()=='https://my-ledger.example.test/api/wallet'
            health=page.get_by_role('link',name='在新分頁檢查自己的 API')
            assert health.get_attribute('href')=='https://my-ledger.example.test/api/health'
            if width<=800:
                page.get_by_role('button',name='展開導覽').click()
                assert page.locator('#ls-mobile-nav').is_visible()
                page.locator('#ls-mobile-nav').get_by_role('link',name='安裝捷徑').click()
                assert not page.locator('#ls-mobile-nav').count()
            page.locator('.ls-faq summary').first.click();assert page.locator('.ls-faq details').first.get_attribute('open') is not None
            page.evaluate('window.scrollTo(0,0)');page.get_by_role('button',name='切換深色模式').click()
            assert page.locator('.ledger-site').get_attribute('data-theme')=='dark'
            page.wait_for_function("getComputedStyle(document.querySelector('.ledger-site')).backgroundColor === 'rgb(21, 22, 26)'", timeout=3000)
            assert page.locator('.ledger-site').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(21, 22, 26)'
            if width in (390,1440):page.screenshot(path=str(QA/f'site-dark-{width}.png'))
            assert not errors,errors
            assert not external,external
            assert not api_calls,api_calls
            record(f'viewport_{width}', 'PASS: light/dark, no overflow, demo, lightbox, four steps, URL validation, no external/API requests')
            ctx.close()
        context=browser.new_context(permissions=['clipboard-read','clipboard-write']);page=context.new_page();page.goto(base,wait_until='networkidle')
        page.locator('#ls-server-url').fill('https://clipboard.example.test')
        page.locator('.ls-endpoint button').click()
        assert page.evaluate('navigator.clipboard.readText()')=='https://clipboard.example.test/api/wallet'
        record('copy_endpoint')
        manifest=json.loads((DIST/'shortcuts/manifest.json').read_text())
        for item in manifest['files']:
            res=context.request.get(base+'/shortcuts/'+item['name']);raw=res.body()
            assert res.status==200 and len(raw)==item['bytes']
            assert hashlib.sha256(raw).hexdigest()==item['sha256']
            assert not raw.startswith((b'<?xml',b'bplist')),'Unsigned plist served as installable file'
            record('signed_download_'+item['name'])
        assert page.locator('a[href="https://github.com/awe7893625/liubai-ledger"]').count()>=2
        record('github_star_links')
        assert context.request.get(base+'/api/health').status==404
        record('public_not_an_api')
        context.close();browser.close()
    (QA/'site-checks.json').write_text(json.dumps({'status':'passed','checks':results},ensure_ascii=False,indent=2))
finally:
    server.shutdown();server.server_close()
