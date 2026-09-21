"""Shared, privacy-safe transaction categorization rules."""
from __future__ import annotations

from pathlib import Path

_YAML_PATH = Path(__file__).resolve().parent.parent.parent / "config" / "category_rules.yaml"

CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("c_food", (
        "餐廳", "早餐", "午餐", "晚餐", "咖啡", "便當", "超商",
        "restaurant", "coffee", "food delivery", "supermarket",
    )),
    ("c_transport", (
        "捷運", "公車", "計程車", "停車", "加油", "高鐵", "火車",
        "taxi", "parking", "transit",
    )),
    ("c_home", (
        "房租", "家具", "家電", "修繕", "rent", "furniture", "appliance",
    )),
    ("c_shopping", (
        "購物", "百貨", "網購", "超市", "shopping", "marketplace", "department store",
    )),
    ("c_fun", (
        "電影", "遊戲", "訂閱", "串流", "movie", "game", "streaming", "subscription",
    )),
    ("c_health", (
        "藥局", "診所", "醫院", "健身", "pharmacy", "clinic", "gym",
    )),
    ("c_education", (
        "書店", "課程", "學費", "book", "course", "tuition",
    )),
    ("c_bills", (
        "電信", "電費", "水費", "瓦斯", "網路費", "insurance", "utility", "telecom",
    )),
    ("c_travel", (
        "飯店", "機票", "訂房", "旅遊", "hotel", "flight", "travel",
    )),
    ("c_other", (
        "手續費", "服務費", "fee",
    )),
]


def _load_yaml_rules() -> list[tuple[str, tuple[str, ...]]] | None:
    try:
        import yaml
        with _YAML_PATH.open(encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return [(r["category"], tuple(r["keywords"])) for r in data["rules"]]
    except Exception:
        return None

_ACTIVE_RULES: list[tuple[str, tuple[str, ...]]] | None = None


def _get_rules() -> list[tuple[str, tuple[str, ...]]]:
    global _ACTIVE_RULES
    if _ACTIVE_RULES is None:
        _ACTIVE_RULES = _load_yaml_rules() or CATEGORY_RULES
    return _ACTIVE_RULES


def guess_category(description: str | None) -> str | None:
    """Return a category ID when a generic keyword rule matches."""
    if not description:
        return None
    low = description.lower()
    for cat_id, keywords in _get_rules():
        if any(keyword.lower() in low for keyword in keywords):
            return cat_id
    return None
