"""Build privacy-clean, auditable Shortcuts templates; no personal data is read."""
from pathlib import Path
import json
import plistlib
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "shortcuts" / "source"

def text(value):
    return {"Value": {"string": value}, "WFSerializationType": "WFTextTokenString"}

def ref(uid, name="輸出"):
    return {"Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": {
        "Type": "ActionOutput", "OutputUUID": uid, "OutputName": name
    }}}, "WFSerializationType": "WFTextTokenString"}

def dictionary(values):
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFKey": text(k), "WFItemType": 0, "WFValue": text(v) if isinstance(v, str) else v}
        for k, v in values.items()
    ]}, "WFSerializationType": "WFDictionaryFieldValue"}

def build(manual):
    actions = []
    def add(kind, **params):
        uid = str(uuid.uuid5(uuid.NAMESPACE_URL, f"ledger-public-v1.1/{manual}/{len(actions)}/{kind}")).upper()
        actions.append({"WFWorkflowActionIdentifier": "is.workflow.actions." + kind,
                        "WFWorkflowActionParameters": {"UUID": uid, **params}})
        return uid
    add("comment", WFCommentActionText=(
        "留白工作室 Ledger 公開範本。請先設定下方 API URL 與 Token。"
        "只連線到你自己的主機；不索取銀行登入、不取得定位。"
        + ("手動輸入只會記帳，不會執行付款。" if manual else
           "需由交易自動化傳入字典：amount / merchant / card / occurred_at。不可直接執行空輸入。")
    ))
    endpoint = add("gettext", WFTextActionText="https://YOUR-LEDGER.invalid/api/wallet")
    token = add("gettext", WFTextActionText="REPLACE_WITH_YOUR_INGEST_TOKEN")
    values = {}
    if manual:
        for key, label, typ in [("amount", "金額（元；測試可填 1）", "Number"),
                                ("merchant", "商家或用途", "Text"),
                                ("card", "Ledger 帳戶暱稱（可填現金）", "Text")]:
            values[key] = ref(add("ask", WFAskActionPrompt=label, WFInputType=typ), label)
        now = add("date", WFDateActionMode="Current Date")
        formatted = add("format.date", WFDate=ref(now, "目前日期"), WFDateFormatStyle="ISO 8601")
        values["occurred_at"] = ref(formatted, "ISO 8601 日期")
    else:
        for key in ("amount", "merchant", "card", "occurred_at"):
            uid = add("getvalueforkey", WFDictionaryKey=key, WFGetDictionaryValueType="Value",
                      WFInput={"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"})
            values[key] = ref(uid, key)
    values.update(payment_method="apple_pay", time_source="shortcut_trigger")
    response = add("downloadurl", WFURL=ref(endpoint,"API URL"), WFHTTPMethod="POST", WFHTTPBodyType="JSON",
                   WFHTTPHeaders=dictionary({"Content-Type":"application/json", "X-Ledger-Token":ref(token,"Token")}),
                   WFJSONValues=dictionary(values))
    if manual:
        add("showresult", Text=ref(response,"伺服器回應"))
    else:
        add("gettext", WFTextActionText=ref(response,"伺服器回應"))
    questions = [
        {"ActionIndex": 1, "Category": "Parameter", "ParameterKey": "WFTextActionText",
         "Text": "自己的 Ledger API URL（必須以 /api/wallet 結尾；不可填官網）",
         "DefaultValue": "https://YOUR-LEDGER.invalid/api/wallet"},
        {"ActionIndex": 2, "Category": "Parameter", "ParameterKey": "WFTextActionText",
         "Text": "自己主機 .env 中的 LEDGER_INGEST_TOKEN（不要包含變數名稱或引號）",
         "DefaultValue": "REPLACE_WITH_YOUR_INGEST_TOKEN"},
    ]
    return {"WFWorkflowName": "Ledger 手動記帳" if manual else "Ledger Apple Pay",
            "WFWorkflowActions": actions, "WFWorkflowImportQuestions": questions,
            "WFWorkflowClientVersion": "3036.0.4.2", "WFWorkflowMinimumClientVersion": 900,
            "WFWorkflowMinimumClientVersionString": "900", "WFWorkflowHasShortcutInputVariables": not manual,
            "WFWorkflowInputContentItemClasses": [] if manual else ["WFDictionaryContentItem"],
            "WFWorkflowOutputContentItemClasses": ["WFStringContentItem"],
            "WFWorkflowTypes": [], "WFQuickActionSurfaces": [],
            "WFWorkflowIcon": {"WFWorkflowIconStartColor": 946986751, "WFWorkflowIconGlyphNumber": 61524}}

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, manual in [("Ledger-Manual", True), ("Ledger-ApplePay", False)]:
        data = build(manual)
        (OUT / f"{name}.shortcut").write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_BINARY))
        (OUT / f"{name}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        print(name, "actions", len(data["WFWorkflowActions"]), "import questions", len(data["WFWorkflowImportQuestions"]))
if __name__ == "__main__":
    main()
