import os
import time
from playwright.sync_api import sync_playwright

def verify_dashboard_mobile():
    target_url = os.getenv("TARGET_URL", "http://localhost:3000")

    with sync_playwright() as p:
        # Use a mobile viewport (iPhone 13/14 Pro roughly)
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(
                viewport={"width": 390, "height": 844},
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
            )
            page = context.new_page()

            # 1. Open Page
            try:
                page.goto(target_url)
            except Exception as e:
                print(f"Error navigating: {e}")
                return

            # 2. Set Session Storage
            page.evaluate("sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true')")

            # 3. Navigate again to trigger login
            page.goto(target_url)

            # 4. Wait for dashboard
            try:
                print("Waiting for 'Money Pulse'...")
                page.wait_for_selector("text=Money Pulse", timeout=10000)
                print("Found 'Money Pulse'")
            except Exception as e:
                print(f"Timeout waiting for selector: {e}")
                page.screenshot(path="error_state_mobile.png")
                return

            # Wait for animations
            time.sleep(2)

            # Take screenshot
            page.screenshot(path="dashboard_verification_mobile.png", full_page=True)
            print("Screenshot taken: dashboard_verification_mobile.png")

        finally:
            browser.close()

if __name__ == "__main__":
    verify_dashboard_mobile()
