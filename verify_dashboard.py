from playwright.sync_api import sync_playwright
import time

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # 1. Open Page
        try:
            page.goto("http://localhost:3000")
        except Exception as e:
            print(f"Error navigating: {e}")
            return

        # 2. Set Session Storage
        page.evaluate("sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true')")

        # 3. Navigate again to trigger login
        page.goto("http://localhost:3000")

        # 4. Wait for dashboard
        try:
            print("Waiting for 'Money Pulse'...")
            page.wait_for_selector("text=Money Pulse", timeout=10000)
            print("Found 'Money Pulse'")
        except Exception as e:
            print(f"Timeout waiting for selector: {e}")
            page.screenshot(path="error_state.png")
            return

        # Wait for animations
        time.sleep(2)

        # Take screenshot
        page.screenshot(path="dashboard_verification.png", full_page=True)
        browser.close()
        print("Screenshot taken: dashboard_verification.png")

if __name__ == "__main__":
    verify_dashboard()
