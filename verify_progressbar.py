from playwright.sync_api import sync_playwright
import time

def verify_progressbar():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        print("Navigating to login with test mode...")
        # 1. Login
        page.goto("http://localhost:3000/#/login?test=true")

        # Wait for dashboard to load
        print("Waiting for dashboard...")
        page.wait_for_selector("text=Action Queue", timeout=10000)

        # 2. Dashboard Screenshot (Challenge Widget, Category Spend Widget)
        # Note: In test mode seed data, CategorySpendWidget might not be populated or visible if no transactions.
        print("Taking dashboard screenshot...")
        time.sleep(2) # Allow animations to finish
        page.screenshot(path="verification_dashboard.png", full_page=True)

        # 3. Navigate to Budget
        print("Navigating to budget...")
        page.goto("http://localhost:3000/#/budget")

        # Wait for Tabs
        print("Waiting for tabs...")
        page.wait_for_selector("button[role='tab']", timeout=10000)

        # 4. Switch to Accounts Tab
        print("Switching to Accounts tab...")
        page.get_by_role("tab", name="Accounts").click()

        # Wait for Accounts content
        print("Waiting for Accounts content...")
        page.wait_for_selector("text=Total Net Worth", timeout=10000)

        # Take Accounts Screenshot
        print("Taking accounts screenshot...")
        time.sleep(1) # Animation
        page.screenshot(path="verification_budget_accounts.png", full_page=True)

        # 5. Switch to Buckets Tab
        print("Switching to Buckets tab...")
        page.get_by_role("tab", name="Buckets").click()

        # Wait for Buckets content (assuming there's some text like 'Buckets' or specific bucket name)
        # Let's wait for a specific element or just wait a bit if we don't know the exact text.
        # BudgetBuckets usually renders a list of buckets.
        time.sleep(2)

        # Take Buckets Screenshot
        print("Taking buckets screenshot...")
        page.screenshot(path="verification_budget_buckets.png", full_page=True)

        browser.close()
        print("Verification complete.")

if __name__ == "__main__":
    verify_progressbar()
