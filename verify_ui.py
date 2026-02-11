from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a viewport size that triggers desktop layout for consistency
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # 1. Login in Test Mode
        print("Navigating to login page...")
        try:
            page.goto("http://localhost:3000/login")

            # Inject Test Mode session storage
            print("Injecting Test Mode session storage...")
            page.evaluate("window.sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true')")

            # Refresh to pick up the change
            page.reload()

            # Wait for test mode banner or dashboard content
            print("Waiting for dashboard...")
            # Look for specific text that indicates successful login/test mode
            # If "TEST MODE" banner is not there, maybe just look for "Hi, Test User" or "Money Pulse"
            try:
                page.wait_for_selector("text=TEST MODE", timeout=5000)
            except:
                print("TEST MODE text not found, checking for dashboard elements...")
                page.wait_for_selector("text=Money Pulse", timeout=5000)

        except Exception as e:
            print(f"Failed to load dashboard: {e}")
            page.screenshot(path="error_login.png")
            browser.close()
            return

        # 2. Go to Budget Page
        print("Navigating to Budget page...")
        # Since it's a SPA, navigate via click or URL hash if supported.
        # Assuming hash router based on memory context
        page.goto("http://localhost:3000/#/budget")

        # 3. Wait for content
        print("Waiting for budget content...")
        try:
            # Wait for tabs to load
            page.wait_for_selector("text=Buckets", timeout=10000)

            # --- VERIFY TRANSACTIONS TAB ---
            print("Clicking Transactions tab...")
            page.get_by_role("tab", name="Transactions").click()
            time.sleep(2) # Allow transitions

            # Verify TransactionMasterList content
            print("Taking screenshot of Transactions tab...")
            page.screenshot(path="verification_transactions.png")

            # Check for specific elements we changed
            # Check for "Income", "Expense", "Net", "Count" text in the summary widget
            expect(page.get_by_text("Income")).to_be_visible()
            expect(page.get_by_text("Expense")).to_be_visible()

            # Check if Search input is present (it should have placeholder)
            expect(page.get_by_placeholder("Search merchant or amount...")).to_be_visible()

            # --- VERIFY BUCKETS TAB ---
            print("Clicking Buckets tab...")
            page.get_by_role("tab", name="Buckets").click()
            time.sleep(2) # Allow transitions

            # Verify BudgetBuckets content
            print("Taking screenshot of Buckets tab...")
            page.screenshot(path="verification_buckets.png")

            # Verify Add Bucket Button text
            create_btn = page.get_by_role("button", name="Create New Bucket")
            expect(create_btn).to_be_visible()
            print("Create New Bucket button found.")

        except Exception as e:
            print(f"Error during verification: {e}")
            page.screenshot(path="error_verification.png")

        finally:
            browser.close()

if __name__ == "__main__":
    run()
