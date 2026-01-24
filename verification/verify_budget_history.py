from playwright.sync_api import sync_playwright
import time

def verify_budget_history():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Login in Test Mode
        print("Navigating to login...")
        page.goto("http://localhost:3000/#/login?test=true")

        # 2. Wait for Dashboard
        print("Waiting for dashboard...")
        try:
            page.get_by_text("Hi, Test User").wait_for(timeout=10000)
        except:
            print("Login failed or timed out. Dumping page content...")
            print(page.content())
            page.screenshot(path="verification/login_fail.png")
            raise

        # 3. Navigate to Budget
        print("Navigating to Budget...")
        # Assuming there is a nav link to Budget. If generic layout, usually text "Budget" works.
        page.get_by_text("Budget", exact=True).click()

        # 4. Wait for Budget page
        print("Waiting for Budget page...")
        # Check for tabs.
        page.get_by_text("Calendar").wait_for()
        page.get_by_text("Buckets").wait_for()

        # 5. Click History Tab
        print("Clicking History tab...")
        page.get_by_role("tab", name="History").click()

        # 6. Verify Content
        # We expect "No History Yet" because mock bucketHistory is empty []
        page.get_by_text("No History Yet").wait_for()

        time.sleep(1) # Wait for animation

        print("Taking screenshot...")
        page.screenshot(path="verification/budget_history.png")

        browser.close()

if __name__ == "__main__":
    verify_budget_history()
