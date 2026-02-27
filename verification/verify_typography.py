import os
import sys
from playwright.sync_api import sync_playwright

def verify_typography():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Go to local app (assuming it's running on port 3000 or similar, but for now we might need to rely on static analysis or start the server)
        # Since I haven't started the server yet in this session, I need to do that first.
        # But for this script, I'll assume it will be running.

        try:
            page.goto("http://localhost:3000")
            page.wait_for_selector("text=Welcome", timeout=5000) # Adjust selector based on actual content

            # Navigate to where ActionQueueItems are visible (Dashboard)
            # Take screenshot of Dashboard
            page.screenshot(path="verification/dashboard_typography.png")
            print("Dashboard screenshot taken")

            # Navigate to Meals to check CookbookModal and QuickRestockRow
            page.goto("http://localhost:3000/#/meals")
            page.wait_for_selector("text=Cookbook", timeout=5000)

            # Open Cookbook Modal
            page.click("text=Cookbook")
            page.wait_for_selector("text=Cookbook", timeout=2000)
            page.screenshot(path="verification/cookbook_typography.png")
            print("Cookbook screenshot taken")

        except Exception as e:
            print(f"Error: {e}")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_typography()
