"""tailscale serve --set-path=/api 會剝掉 /api 前綴再轉發。
此 middleware 把沒有 /api 前綴的請求補回 /api，本地直打 /api/* 不受影響。"""
class ApiPrefixFix:
    def __init__(self, app):
        self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and not scope["path"].startswith("/api"):
            scope = dict(scope)
            scope["path"] = "/api" + scope["path"]
            scope["raw_path"] = scope["path"].encode()
        await self.app(scope, receive, send)
