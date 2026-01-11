
import os
import time
from playwright.sync_api import sync_playwright

def verify_test_cards():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a mobile viewport to match "mobile-first" design
        context = browser.new_context(viewport={"width": 375, "height": 812})
        page = context.new_page()

        # Navigate to the Test Cards page
        page.goto("http://localhost:3000/#/test-cards")

        # Wait for rendering
        time.sleep(2)

        # Take a screenshot
        page.screenshot(path="verification/test_cards_page.png", full_page=True)

        browser.close()

if __name__ == "__main__":
    verify_test_cards()
