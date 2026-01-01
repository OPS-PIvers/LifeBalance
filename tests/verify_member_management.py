
import os
import time
from playwright.sync_api import sync_playwright, expect

def verify_member_management():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Navigate to home (HashRouter handles root)
        page.goto("http://localhost:3000/#/")

        time.sleep(3)
        print(f"Current URL: {page.url}")

        # Take a screenshot
        page.screenshot(path="tests/initial_page.png")

        # Go to settings
        print("Navigating to settings...")
        page.goto("http://localhost:3000/#/settings")
        time.sleep(3)
        print(f"Current URL: {page.url}")

        # Take a screenshot
        page.screenshot(path="tests/settings_page.png")

        browser.close()

if __name__ == "__main__":
    verify_member_management()
