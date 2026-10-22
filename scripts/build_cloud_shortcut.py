"""Build two auditable, tenant-neutral Cloud shortcuts. Signing is a separate step.

Cloud: pairing ticket or Wallet Dictionary -> receipt-gated ingest.
Manual: account/category config -> expense/income -> persisted draft -> safe retry.
No bank names, credentials, GPS or private hostnames are bundled.
"""
from __future__ import annotations
import json
import os
import plistlib
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API_BASE = os.environ.get("LEDGER_CLOUD_API_BASE", "https://app.blankspaces.uk").rstrip("/")
PAIR_URL = API_BASE + "/api/v2/pair/exchange"
INGEST_URL = API_BASE + "/api/v2/wallet/ingest"
TOKEN_PATH = "Shortcuts/LiubaiLedger/device-token.txt"
DRAFT_PATH = "Shortcuts/LiubaiLedger/pending-manual.json"
NAMESPACE = uuid.UUID("447d32f5-a096-4be8-aada-4bb8b6aa88d2")


def ident(name):
    return str(uuid.uuid5(NAMESPACE, name)).upper()


def action(kind, name, **params):
    return {"WFWorkflowActionIdentifier": "is.workflow.actions." + kind,
            "WFWorkflowActionParameters": {"UUID": ident(name), **params}}


def output(name):
    return {"Value": {"Type": "ActionOutput", "OutputUUID": ident(name), "OutputName": name},
            "WFSerializationType": "WFTextTokenAttachment"}


def incoming():
    return {"Value": {"Type": "ExtensionInput"}, "WFSerializationType": "WFTextTokenAttachment"}


def text(s):
    return {"Value": {"string": s}, "WFSerializationType": "WFTextTokenString"}


def token(name):
    return {"Value": {"string": "\ufffc", "attachmentsByRange": {"{0, 1}": output(name)["Value"]}},
            "WFSerializationType": "WFTextTokenString"}


def mixed(*parts):
    s = ""; attachments = {}
    for part in parts:
        if isinstance(part, tuple):
            offset = len(s.encode("utf-16-le")) // 2
            attachments[f"{{{offset}, 1}}"] = output(part[0])["Value"]
            s += "\ufffc"
        else:
            s += part
    return {"Value": {"string": s, "attachmentsByRange": attachments}, "WFSerializationType": "WFTextTokenString"}


def dictionary(items):
    return {"Value": {"WFDictionaryFieldValueItems": [
        {"WFItemType": 0, "WFKey": text(k), "WFValue": v} for k, v in items
    ]}, "WFSerializationType": "WFDictionaryFieldValue"}


def cond(name, group, mode, value=None, condition=100, equals=None):
    params = {"GroupingIdentifier": ident(group), "WFControlFlowMode": mode}
    if mode == 0:
        params.update(WFCondition=condition, WFInput={"Type": "Variable", "Variable": value})
        if equals is not None: params["WFConditionalActionString"] = equals
    return action("conditional", name, **params)


def get(name, key, source):
    return action("getvalueforkey", name, WFDictionaryKey=key, WFInput=source, WFGetDictionaryValueType="Value")


def notice(name, body, title="留白 Ledger"):
    return action("notification", name, WFNotificationActionTitle=title,
                  WFNotificationActionBody=body, WFNotificationActionSound=False)


def stop(name):
    return action("exit", name)


def write_file(prefix, source, filename):
    return [
        action("setitemname", prefix+"-name", WFInput=source, WFName=filename, WFDontIncludeFileExtension=False),
        action("documentpicker.save", prefix+"-save", WFInput=output(prefix+"-name"),
               WFAskWhereToSave=False, WFFileDestinationPath="Shortcuts/LiubaiLedger/", WFSaveFileOverwrite=True),
    ]


def require_value(prefix, value, message):
    return [cond(prefix+"-if", prefix, 0, value, condition=101),
            notice(prefix+"-notice", message, "尚未確認"), stop(prefix+"-exit"),
            cond(prefix+"-end", prefix, 2)]


def load_device():
    actions = [action("documentpicker.open", "token-file-read", WFFileErrorIfNotFound=False,
                      WFGetFolderContents=False, WFGetFilePath=TOKEN_PATH, WFShowFilePicker=False),
               action("detect.text", "token-text", WFInput=output("token-file-read"))]
    actions += require_value("needs-pair", output("token-text"), "尚未配對。請開啟 app.blankspaces.uk → 設定 → 連接 iPhone。")
    actions += [action("url", "config-url", WFURLActionURL=INGEST_URL),
                action("downloadurl", "config", WFURL=output("config-url"), WFHTTPMethod="GET",
                       WFHTTPHeaders=dictionary([("X-Ledger-Device-Token", token("token-text"))])),
                get("config-result", "result", output("config")),
                cond("config-check", "config-gate", 0, output("config-result"), condition=5, equals="connected"),
                notice("config-error", "無法確認裝置連線。請重新配對，尚未送出任何交易。"),
                stop("config-stop"), cond("config-end", "config-gate", 2),
                get("request-id", "request_id", output("config")),
                get("ledger-label", "ledger_label", output("config"))]
    return actions


FIELDS = ("amount", "merchant", "card", "account_id", "category_id", "note", "source", "direction", "currency", "occurred_at", "request_id")


def submit(prefix, payload, clear_manual=False):
    actions = []
    for key in FIELDS:
        actions.append(get(prefix+"-"+key, key, payload))
    actions += [
        action("url", prefix+"-url", WFURLActionURL=INGEST_URL),
        action("downloadurl", prefix+"-response", WFURL=output(prefix+"-url"), WFHTTPMethod="POST", WFHTTPBodyType="JSON",
               WFHTTPHeaders=dictionary([("Content-Type", text("application/json")), ("X-Ledger-Device-Token", token("token-text"))]),
               WFJSONValues=dictionary([(key, token(prefix+"-"+key)) for key in FIELDS])),
        get(prefix+"-tx", "tx_id", output(prefix+"-response")),
        get(prefix+"-result", "result", output(prefix+"-response")),
        get(prefix+"-receipt", "receipt", output(prefix+"-response")),
        get(prefix+"-message", "message", output(prefix+"-response")),
    ]
    actions += require_value(prefix+"-missing-tx", output(prefix+"-tx"),
        "尚未確認入帳。請檢查網路、配對與輸入；手動記帳草稿會保留，勿重建相同交易。")
    actions += require_value(prefix+"-missing-receipt", output(prefix+"-result"), "伺服器未回覆入帳收據，請勿視為記帳成功。")
    actions += [cond(prefix+"-receipt-check", prefix+"-receipt-gate", 0, output(prefix+"-receipt"), condition=5, equals="ledger_saved_v2"),
                notice(prefix+"-receipt-error", "入帳收據不符，請保留草稿並確認帳本。", "尚未確認"),
                stop(prefix+"-receipt-stop"), cond(prefix+"-receipt-end", prefix+"-receipt-gate", 2)]
    if clear_manual:
        actions.append(action("gettext", prefix+"-empty", WFTextActionText=""))
        actions += write_file(prefix+"-clear", output(prefix+"-empty"), "pending-manual.json")
    actions += [notice(prefix+"-notice", token(prefix+"-message")), stop(prefix+"-finish")]
    return actions


def metadata(name, actions, input_classes):
    return {
        "WFWorkflowName": name, "WFWorkflowActions": actions,
        "WFWorkflowIcon": {"WFWorkflowIconStartColor": 4282601983, "WFWorkflowIconGlyphNumber": 59802},
        "WFWorkflowClientVersion": "4033.0.4.3", "WFWorkflowMinimumClientVersion": 900,
        "WFWorkflowMinimumClientVersionString": "900", "WFWorkflowOutputContentItemClasses": [],
        "WFWorkflowHasOutputFallback": False, "WFWorkflowHasShortcutInputVariables": bool(input_classes),
        "WFWorkflowInputContentItemClasses": input_classes, "WFWorkflowTypes": [], "WFQuickActionSurfaces": [],
    }


def build():
    a = [action("comment", "help", WFCommentActionText=(
        "留白自動記帳 v2｜app.blankspaces.uk\n先從網站設定連接 iPhone。Wallet 自動化傳入辭典 amount / merchant / card。"
        "所有銀行共用此捷徑；卡片對應在各自的網站帳號設定。只在後端回覆交易編號與收據後通知。")),
        action("gettext", "input-text", WFTextActionText=incoming()),
        cond("if-pair", "pair-mode", 0, output("input-text"), condition=8, equals="pair:"),
        action("url", "pair-url", WFURLActionURL=PAIR_URL),
        action("downloadurl", "pair-response", WFURL=output("pair-url"), WFHTTPMethod="POST", WFHTTPBodyType="JSON",
               WFHTTPHeaders=dictionary([("Content-Type", text("application/json"))]),
               WFJSONValues=dictionary([("pair_ticket", token("input-text")), ("device_name", text("iPhone"))])),
        get("new-device-token", "device_token", output("pair-response")),
    ]
    a += require_value("pair-error", output("new-device-token"), "配對未成功，請回網站重新產生票券。舊裝置憑證不會覆蓋。")
    a += write_file("pair-token", output("new-device-token"), "device-token.txt")
    a += [notice("pair-ok", "iPhone 已連接。手動記帳沿用這份憑證，先用測試連線驗證。"), stop("pair-done"), cond("pair-end", "pair-mode", 2)]
    a += require_value("wallet-empty", incoming(), "這支捷徑由 Wallet 交易自動化執行。手動記帳請改開「留白手動記帳」。")
    a += load_device()
    for key in ("amount", "merchant", "card"):
        a.append(get("wallet-"+key, key, incoming()))
    a += [action("date", "wallet-date", WFDateActionMode="Current Date"),
          action("format.date", "wallet-time", WFDate=token("wallet-date"), WFDateFormatStyle="ISO 8601"),
          action("dictionary", "wallet-body", WFItems=dictionary([
              ("amount", token("wallet-amount")), ("merchant", token("wallet-merchant")), ("card", token("wallet-card")),
              ("account_id", text("")), ("category_id", text("")), ("note", text("")), ("source", text("apple_pay")),
              ("direction", text("expense")), ("currency", text("TWD")), ("occurred_at", token("wallet-time")), ("request_id", token("request-id")),
          ]))]
    a += submit("wallet-post", output("wallet-body"))
    return metadata("留白自動記帳", a, ["WFStringContentItem", "WFDictionaryContentItem"])


def choose_config(name, key, prompt):
    return [get(name+"-map", key, output("config")),
            action("getvalueforkey", name+"-keys", WFInput=output(name+"-map"), WFGetDictionaryValueType="All Keys"),
            action("choosefromlist", name+"-choice", WFInput=output(name+"-keys"),
                   WFChooseFromListActionPrompt=prompt, WFChooseFromListActionSelectMultiple=False),
            get(name+"-value", token(name+"-choice"), output(name+"-map"))]


def build_manual():
    a = [action("comment", "manual-help", WFCommentActionText=(
        "留白手動記帳 v2｜app.blankspaces.uk\n先在網站建立自己的付款方式，安裝自動記帳並配對一次。兩支捷徑共用憑證。"
        "不需改 API、JSON 或卡名；每次讀取自己的付款選項。\n"
        "送出前保存一筆草稿；網路失敗時重開可重送相同請求，不會建立第二筆。"
        "設定清單載入仍需網路；本捷徑不是完整離線帳本。"))]
    a += load_device()
    a += choose_config("mode", "directions", "留白記帳")
    a += [cond("probe-check", "probe", 0, output("mode-value"), condition=4, equals="probe"),
          notice("probe-ok", "連線成功，沒有建立交易。你的付款方式清單可正常讀取。"),
          stop("probe-done"), cond("probe-end", "probe", 2),
          action("documentpicker.open", "pending-file", WFFileErrorIfNotFound=False, WFGetFolderContents=False,
                 WFGetFilePath=DRAFT_PATH, WFShowFilePicker=False),
          action("detect.text", "pending-text", WFInput=output("pending-file")),
          cond("pending-check", "pending", 0, output("pending-text"))]
    a += choose_config("pending-action", "pending_actions", "上次記帳尚未確認，請先處理草稿")
    a += [cond("pending-cancel-check", "pending-cancel", 0, output("pending-action-value"), condition=4, equals="cancel"),
          stop("pending-cancel-stop"), cond("pending-cancel-end", "pending-cancel", 2),
          cond("pending-retry-check", "pending-retry", 0, output("pending-action-value"), condition=4, equals="retry"),
          action("detect.dictionary", "pending-dictionary", WFInput=output("pending-text"))]
    a += submit("retry", output("pending-dictionary"), clear_manual=True)
    a += [cond("pending-retry-end", "pending-retry", 2),
          action("alert", "discard-confirm", WFAlertActionTitle="只捨棄本機草稿",
                 WFAlertActionMessage="請先到帳本確認上次是否已入帳，再重新輸入，避免自行建立重複交易。此操作不刪除雲端交易。", WFAlertActionCancelButtonShown=True),
          action("gettext", "discard-empty", WFTextActionText="")]
    a += write_file("discard-draft", output("discard-empty"), "pending-manual.json")
    a += [cond("pending-end", "pending", 2),
          action("ask", "manual-amount", WFAskActionPrompt="金額（台幣，請填正數）", WFInputType="Number"),
          action("ask", "manual-merchant", WFAskActionPrompt="商家或用途", WFInputType="Text")]
    a += choose_config("account", "accounts", "選擇付款方式（自己的信用卡、現金或電子支付）")
    a += choose_config("category", "categories", "選擇分類")
    a += [action("ask", "manual-note", WFAskActionPrompt="備註（選填，可留白）", WFInputType="Text", WFAskActionDefaultAnswer=""),
          action("date", "manual-date", WFDateActionMode="Current Date"),
          action("format.date", "manual-time", WFDate=token("manual-date"), WFDateFormatStyle="ISO 8601"),
          action("alert", "manual-confirm", WFAlertActionTitle="確認這筆記帳", WFAlertActionCancelButtonShown=True,
                 WFAlertActionMessage=mixed("帳本：", ("ledger-label",), "\n", ("mode-choice",), " NT$", ("manual-amount",), "\n", ("manual-merchant",), "\n", ("account-choice",), " · ", ("category-choice",))),
          action("dictionary", "manual-body", WFItems=dictionary([
              ("amount", token("manual-amount")), ("merchant", token("manual-merchant")), ("card", token("account-choice")),
              ("account_id", token("account-value")), ("category_id", token("category-value")),
              ("note", token("manual-note")), ("source", text("manual")), ("direction", token("mode-value")),
              ("currency", text("TWD")), ("occurred_at", token("manual-time")), ("request_id", token("request-id")),
          ])),
          action("gettext", "manual-json", WFTextActionText=token("manual-body"))]
    a += write_file("manual-draft", output("manual-json"), "pending-manual.json")
    a += submit("manual-post", output("manual-body"), clear_manual=True)
    return metadata("留白手動記帳", a, [])


def validate(data):
    declared = set(); groups = []
    def refs(value):
        if isinstance(value, dict):
            if "OutputUUID" in value: yield value["OutputUUID"]
            for child in value.values(): yield from refs(child)
        elif isinstance(value, list):
            for child in value: yield from refs(child)
    for item in data["WFWorkflowActions"]:
        p = item["WFWorkflowActionParameters"]
        assert set(refs(p)) <= declared, f"forward reference: {item}"
        assert p["UUID"] not in declared
        declared.add(p["UUID"])
        if item["WFWorkflowActionIdentifier"].endswith("conditional"):
            mode = p["WFControlFlowMode"]; group = p["GroupingIdentifier"]
            if mode == 0: groups.append(group)
            elif mode == 2: assert groups.pop() == group
    assert not groups, "unbalanced conditionals"
    raw = json.dumps(data, ensure_ascii=False)
    for forbidden in ("REPLACE_WITH", "X-Ledger-Token", "getcurrentlocation", ".ts.net", "PROJECT.vercel.app"):
        assert forbidden not in raw
    assert TOKEN_PATH in raw and INGEST_URL in raw and "X-Ledger-Device-Token" in raw
    assert '"tx_id"' in raw and '"result"' in raw, "receipt gates required"


if __name__ == "__main__":
    assert API_BASE.startswith("https://") and API_BASE == "https://app.blankspaces.uk", "Only the brand HTTPS endpoint may ship"
    for name, data in (("Liubai-Cloud", build()), ("Liubai-Manual", build_manual())):
        validate(data)
        source = ROOT / "shortcuts/src" / (name+".plist")
        unsigned = ROOT / "shortcuts/source" / (name+".unsigned.shortcut")
        source.parent.mkdir(parents=True, exist_ok=True); unsigned.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML, sort_keys=False))
        unsigned.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_BINARY, sort_keys=False))
        print(f"PASS {name}: {len(data['WFWorkflowActions'])} actions, linked refs, receipt gates, no bundled credentials")
