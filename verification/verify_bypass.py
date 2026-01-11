from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a consistent context to persist localStorage if needed
        context = browser.new_context()
        page = context.new_page()

        try:
            # 1. Access Login Page with bypass param
            print("Navigating to login with bypass...")
            page.goto("http://localhost:3000/#/login?bypass=true")

            # Wait for reload and redirect to Dashboard
            # The Dashboard should have the "TEST MODE ENABLED" banner
            print("Waiting for dashboard redirect...")

            # We expect to see "Dashboard" or some element from the dashboard
            # Also the red banner
            expect(page.get_by_text("TEST MODE ENABLED")).to_be_visible(timeout=10000)

            print("Test Mode Banner found!")

            # Verify we are on dashboard (e.g. "Safe to Spend" text)
            expect(page.get_by_text("Safe to Spend")).to_be_visible()

            # Take screenshot
            page.screenshot(path="verification/bypass_success.png")
            print("Screenshot saved to verification/bypass_success.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/bypass_error.png")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    run()
