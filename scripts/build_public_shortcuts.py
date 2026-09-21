"""Build privacy-safe standalone Shortcuts. Signing is a separate macOS step.
No original shared shortcut, contact information, private URL, or token is copied.
Wallet expects a Dictionary input with amount, merchant and card keys.
"""
from __future__ import annotations
import json
import plistlib
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMESPACE = uuid.UUID("aec87970-e82e-4bbf-ac28-97c8bb29d955")
PLACEHOLDER_URL = "https://ledger.example.invalid/api/wallet"
PLACEHOLDER_TOKEN = "REPLACE_WITH_YOUR_INGEST_TOKEN"

def ident(name):
    return str(uuid.uuid5(NAMESPACE, name)).upper()

def output(name):
    return {"Value": {"Type": "ActionOutput", "OutputUUID": ident(name), "OutputName": name}, "WFSerializationType": "WFTextTokenAttachment"}

def text(value):
    return {"Value": {"string": value}, "WFSerializationType": "WFTextTokenString"}

def token(name):
    return {"Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": output(name)["Value"]}}, "WFSerializationType": "WFTextTokenString"}

def dictionary(items):
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": text(key), "WFValue": value} for key, value in items
    ]}, "WFSerializationType": "WFDictionaryFieldValue"}

def action(kind, name, **params):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions." + kind,
            "WFWorkflowActionParameters": {"UUID": ident(name), **params}}

def build(mode):
    prefix = "wallet" if mode == "wallet" else "manual"
    key = lambda name: prefix + "-" + name
    actions = [
        action("comment", key("help"), WFCommentActionText=(
            "Ledger｜留白工作室 · 公開版 1.1.2\n"
            "這一塊是說明註解：可以保留，不會傳送；只有註解可以刪除。\n"
            "下面兩個『文字』是實際設定：只改內容，不要刪掉整個動作。\n"
            + ("Wallet 必須收到交易自動化的字典輸入，不要直接按 ▶ 空跑。先用 Ledger Manual 測通。" if mode == "wallet" else
               "先填自己的 URL 與 Token，再按 ▶。金額可填 1、商家填『連線測試』。"))),
        action("comment", key("url-help"), WFCommentActionText=(
            "① 網址設定 LEDGER_URL\n下一個『文字』：把整段占位網址換成自己的完整 HTTPS API 網址，以 /api/wallet 結尾。\n"
            "不要填公開教學站。不要把 LEDGER_URL= 或說明文字貼進這一格。")),
        action("gettext", key("url"), WFTextActionText=PLACEHOLDER_URL),
        action("comment", key("token-help"), WFCommentActionText=(
            "② Token 設定 LEDGER_TOKEN\n下一個『文字』：用自己主機 .env 的 LEDGER_INGEST_TOKEN 值取代占位文字。\n"
            "只貼等號右邊的值，不含引號、變數名稱或空白。不要刪除此文字動作；不需貼給工作室。")),
        action("gettext", key("token"), WFTextActionText=PLACEHOLDER_TOKEN),
        action("comment", key("run-help"), WFCommentActionText=(
            "③ 以下是執行區，請保留\n"
            + ("在『捷徑輸入』取得 amount / merchant / card 的『數值』，指的是字典 Value，不是強制轉成數字。商家與卡片仍為文字。\n" if mode == "wallet" else "依提示輸入金額、商家與卡片或現金名稱。\n")
            + "取得 URL 內容已設定 POST、JSON 與 X-Ledger-Token。展開藍色箭頭可檢查。\n"
            "通知只是 API 回應；看到 ok:true 與 tx_id，還要到自己的流水確認，不代表銀行已同步。")),
    ]
    if mode == "wallet":
        incoming = {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}
        for field in ("amount", "merchant", "card"):
            actions.append(action("getvalueforkey", key(field), WFDictionaryKey=field,
                                  WFInput=incoming, WFGetDictionaryValueType="Value"))
    else:
        for field, prompt, input_type in [
            ("amount", "金額（元；正數為支出，負數為退款）", "Number"),
            ("merchant", "商家／用途（第一次可輸入：連線測試）", "Text"),
            ("card", "Wallet 卡片名稱，或輸入：現金", "Text"),
        ]:
            actions.append(action("ask", key(field), WFAskActionPrompt=prompt, WFInputType=input_type))
    actions += [
        action("url", key("endpoint"), WFURLActionURL=token(key("url"))),
        action("downloadurl", key("response"), WFInput=output(key("endpoint")),
               WFHTTPMethod="POST", WFHTTPBodyType="JSON",
               WFHTTPHeaders=dictionary([("X-Ledger-Token", token(key("token"))),
                                         ("Content-Type", text("application/json"))]),
               WFJSONValues=dictionary([
                   ("amount", token(key("amount"))), ("merchant", token(key("merchant"))),
                   ("card", token(key("card"))), ("payment_method", text("apple_pay" if mode == "wallet" else "manual")),
                   ("time_source", text("server_received")),
               ])),
        action("notification", key("notice"), WFNotificationActionTitle="Ledger API 回應",
               WFNotificationActionBody=token(key("response")), WFNotificationActionSound=False),
    ]
    data = {
        "WFWorkflowName": "Ledger Wallet" if mode == "wallet" else "Ledger Manual",
        "WFWorkflowActions": actions,
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59802},
        "WFWorkflowClientVersion": "4033.0.4.3",
        "WFWorkflowClientRelease": "27A000",
        "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False,
        "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900",
        "WFWorkflowHasShortcutInputVariables": mode == "wallet",
        "WFWorkflowInputContentItemClasses": ["WFDictionaryContentItem"] if mode == "wallet" else [],
        "WFWorkflowTypes": [], "WFQuickActionSurfaces": [],
        "WFWorkflowImportQuestions": [
            {"ActionIndex": 2, "Category": "Parameter", "ParameterKey": "WFTextActionText",
             "Text": "你的 Ledger API URL（完整 HTTPS 網址，以 /api/wallet 結尾；不可填官網）",
             "DefaultValue": PLACEHOLDER_URL},
            {"ActionIndex": 4, "Category": "Parameter", "ParameterKey": "WFTextActionText",
             "Text": "你的 LEDGER_INGEST_TOKEN 值（只填等號右邊，不含引號；不要分享）",
             "DefaultValue": PLACEHOLDER_TOKEN},
        ],
    }
    return data

def validate(data):
    actions=data["WFWorkflowActions"]
    declared=set()
    def refs(value):
        if isinstance(value,dict):
            if "OutputUUID" in value:
                yield value["OutputUUID"]
            for sub in value.values(): yield from refs(sub)
        elif isinstance(value,list):
            for sub in value: yield from refs(sub)
    for a in actions:
        p=a["WFWorkflowActionParameters"]
        assert set(refs(p)) <= declared, "Forward or dangling output reference"
        declared.add(p["UUID"])
    raw=json.dumps(data,ensure_ascii=False)
    for forbidden in ("TriggerOutput", "WFWalletTransactionTrigger", "getcurrentlocation", "contacts", "https://mac.", "X-API-Key"):
        assert forbidden not in raw
    assert raw.count(PLACEHOLDER_URL)==2
    assert "X-Ledger-Token" in raw and '"WFHTTPMethod": "POST"' in raw
    assert len([a for a in actions if a["WFWorkflowActionIdentifier"].endswith("downloadurl")])==1

if __name__ == "__main__":
    target=ROOT/"shortcuts"/"src"
    target.mkdir(parents=True,exist_ok=True)
    for mode in ("wallet","manual"):
        data=build(mode);validate(data)
        out=target/("Ledger-"+mode.title()+".plist")
        out.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML,sort_keys=False))
        print(f"PASS {out.name}: {len(data['WFWorkflowActions'])} actions; linked outputs; no private configuration")
