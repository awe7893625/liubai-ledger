# Ledger UI screenshots — 2026-10-24

Screenshots are **real rendered application output in an isolated Playwright test**, using synthetic ledger fixtures. No personal transactions, real login credentials or production accounts are included. The WebKit captures approximate the Safari rendering engine at 390×844; they are **not screenshots from a physical iPhone**.

Files `01–09` cover homepage, manual entry, save button, transactions, explore, general settings, accounts/categories and iPhone manual-first workflow. `10` is the 1280px Chromium desktop homepage.

Public-account signup, current M4 private-data synchronization, Supabase pending migrations and native Apple Pay tap compatibility are **not proven** by these screenshots.

Core visual QA uses `python3 scripts/check_product_finish_ui.py` with all APIs mocked; layout assertions cover 320/390/430px Chromium, 390px WebKit and 1280px Chromium.
