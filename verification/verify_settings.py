
import os
import time
from playwright.sync_api import sync_playwright

def verify_settings_cards():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a mobile viewport to match "mobile-first" design
        context = browser.new_context(viewport={"width": 375, "height": 812})
        page = context.new_page()

        # Navigate to the Settings page (hash router)
        # Vite config says port 3000
        page.goto("http://localhost:3000/#/settings")

        # Wait for potentially login redirect
        time.sleep(3)

        # Take a screenshot
        page.screenshot(path="verification/settings_page.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    verify_settings_cards()
