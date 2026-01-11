
from playwright.sync_api import sync_playwright, expect

def verify_analytics_modal():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # 1. Navigate to the Dashboard
        page.goto("http://localhost:3000/")

        # Wait for the app to initialize using Playwright's load state
        # networkidle is better than fixed timeout, though dependent on network activity
        try:
            page.wait_for_load_state("networkidle", timeout=10000)
        except:
            print("Warning: Network idle timeout, proceeding...")

        # Check if we are on login page
        if page.url.endswith("/login"):
            print("Redirected to login. Attempting to bypass or log in...")
            return

        try:
            # 2. Find the Analytics button
            # Try robust selector first (by accessible name)
            # Note: The button currently lacks an aria-label in the code, so get_by_role might fail if it relies on text content inside.
            # The button contains <BarChart2 />, so it might not have text.
            # We will use the class selector as fallback but try to be cleaner.

            # Ideally, we should add aria-label to the button in Dashboard.tsx, but I will stick to verification script changes first.
            # Actually, I should probably add aria-label to Dashboard.tsx as well for accessibility!

            analytics_btn = page.locator("button.p-3.bg-white.text-brand-600").first

            if analytics_btn.is_visible():
                print("Found Analytics button, clicking...")
                analytics_btn.click()

                # 3. Wait for Modal to open
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
