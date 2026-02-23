import time
from playwright.sync_api import sync_playwright

def verify_dashboard():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to test mode login
        url = "http://localhost:3000/#/login?test=true"
        print(f"Navigating to {url}")
        page.goto(url)

        # Wait for the dashboard to load. We can wait for the greeting text.
        # "Hi, Test User" or similar.
        print("Waiting for dashboard...")
        try:
            # Wait for a specific element that confirms we are on the dashboard
            page.wait_for_selector("text=Hi, Test User", timeout=30000)

            # Wait a bit more for widgets to animate in
            time.sleep(2)

            # Take a screenshot
            screenshot_path = "verification_dashboard.png"
            page.screenshot(path=screenshot_path, full_page=True)
            print(f"Screenshot saved to {screenshot_path}")
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="error_screenshot.png")
            print("Saved error screenshot.")

        browser.close()

if __name__ == "__main__":
    verify_dashboard()
