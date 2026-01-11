
import os
from playwright.sync_api import sync_playwright, expect

def verify_analytics_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 1. Navigate to the Dashboard
        # Since we are using HashRouter, we go to /
        page.goto("http://localhost:3000/")

        # Wait for the page to load (look for dashboard greeting or header)
        # Note: Auth is tricky in testing.
        # If the app redirects to login, we might need to mock auth or use a test account.
        # Based on memory, this project has issues with auth in tests.
        # However, we can try to wait for the analytics button.

        # Wait for the app to initialize
        page.wait_for_timeout(5000)

        # Check if we are on login page
        if page.url.endswith("/login"):
            print("Redirected to login. Attempting to bypass or log in...")
            # If we can't login easily, verification might be hard.
            # But let's see if we can find the Analytics button on Dashboard.
            # Assuming we might be able to mock the context if we were using a specific test page,
            # but here we are running against the full app.

            # Trying to use a test route if available?
            # Memory says: "Isolated UI verification of context-dependent components (e.g., Modals) requires creating temporary pages with Mock Context Providers"
            pass

        try:
            # 2. Find the Analytics button (BarChart icon)
            # The dashboard has a button with BarChart2 icon.
            # We can look for a button with proper aria-label or just the button in the header.
            # The code shows:
            # <button onClick={() => setIsAnalyticsOpen(true)} ...> <BarChart2 size={20} /> </button>
            # It doesn't have an aria-label in the code snippet I read!
            # It's the button in the header.

            # Let's try to find it by class or role
            # It has 'bg-white border border-brand-100 rounded-xl shadow-sm text-brand-600'

            analytics_btn = page.locator("button.p-3.bg-white.text-brand-600").first
            if analytics_btn.is_visible():
                print("Found Analytics button, clicking...")
                analytics_btn.click()

                # 3. Wait for Modal to open
                # Modal has text "Analytics"
                expect(page.get_by_text("Analytics", exact=True)).to_be_visible(timeout=5000)

                # 4. Take Screenshot
                page.screenshot(path="verification/analytics_modal.png")
                print("Screenshot taken: analytics_modal.png")
            else:
                print("Analytics button not found. Taking debug screenshot.")
                page.screenshot(path="verification/debug_dashboard.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")

        browser.close()

if __name__ == "__main__":
    verify_analytics_modal()
