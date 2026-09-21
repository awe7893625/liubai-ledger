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
            "Ledger｜留百工作室 · 公開版\n"
            "請修改下面兩個文字動作：第一格 LEDGER_URL，第二格 LEDGER_TOKEN。\n"
            "URL 必須是自己的 HTTPS 網域，以 /api/wallet 結尾。Token 必須與自己的伺服器設定相同。\n"
            "未設定的 example.invalid 網址不會連到任何人的帳本。\n"
            "Wallet 版請由 iPhone 交易自動化傳入字典：amount / merchant / card。\n"
            "本模板不要求定位、不讀聯絡人或卡號。回應通知請查看 ok 與 tx_id，不代表銀行交易同步。")),
        action("gettext", key("url"), WFTextActionText=PLACEHOLDER_URL),
        action("gettext", key("token"), WFTextActionText=PLACEHOLDER_TOKEN),
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
        "WFWorkflowTypes": [], "WFQuickActionSurfaces": [], "WFWorkflowImportQuestions": [],
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
    assert raw.count(PLACEHOLDER_URL)==1
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
