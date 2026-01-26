import os
import time
from playwright.sync_api import sync_playwright

def verify_recurring_bills():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use mobile viewport as per memory
        context = browser.new_context(viewport={"width": 390, "height": 844})

        # Init script for test mode
        context.add_init_script("sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true');")

        page = context.new_page()

        try:
            print("Navigating to login...")
            page.goto("http://localhost:3000/#/login?test=true")
            page.wait_for_timeout(5000)
            print(f"Current URL after login wait: {page.url}")

            if "dashboard" not in page.url:
                print("Trying to click login button if exists...")
                # Maybe there is a button?
                # But usually test=true bypasses it.
                # Let's try direct nav to dashboard
                page.goto("http://localhost:3000/#/dashboard")
                page.wait_for_timeout(5000)
                print(f"Current URL after dashboard nav: {page.url}")

            # 2. Go to Budget
            page.goto("http://localhost:3000/#/budget")
            print("Budget page loaded")
            page.wait_for_timeout(2000)

            # 3. Find Recurring Button (Repeat icon)
            # It's an icon button, aria-label="Manage Recurring Bills"
            # Wait for Calendar Tab to be active (default)
            # Check if we are on budget page
            if "budget" not in page.url:
                print("Failed to reach budget page")
                page.screenshot(path="/home/jules/verification/failed_budget.png")
                return

            btn = page.get_by_label("Manage Recurring Bills")
            btn.wait_for(state="visible", timeout=5000)
            btn.click()
            print("Clicked Recurring Bills button")

            # 4. Wait for Modal
            page.get_by_text("Recurring Manager").wait_for()
            print("Modal opened")

            # 5. Screenshot
            os.makedirs("/home/jules/verification", exist_ok=True)
            page.screenshot(path="/home/jules/verification/recurring_bills.png")
            print("Screenshot taken")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_recurring_bills()
