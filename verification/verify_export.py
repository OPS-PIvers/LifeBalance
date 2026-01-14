
from playwright.sync_api import sync_playwright

def verify_export_feature():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a larger viewport to ensure desktop layout and visibility of all elements
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        try:
            # Enable Test Mode to use Mock Providers (this should populate data)
            page.goto("http://localhost:3000")
            page.evaluate("sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true')")

            # Navigate to budget
            page.get_by_role("link", name="Budget").click()

            # Click on "History" tab to see transactions
            page.get_by_role("button", name="History").click()

            # Wait for text "Clear" or just the export button directly
            # The filter "All Categories" is an option in a select, so it might be hidden until clicked

            # Look for the Export button directly
            export_button = page.get_by_role("button", name="Export")

            # Wait for it to be visible
            export_button.wait_for(state="visible", timeout=10000)

            # Scroll to the export button or filters area to make sure it's in view
            export_button.scroll_into_view_if_needed()

            # Take a screenshot of the Transaction Master List area including the export button
            page.screenshot(path="verification/verification.png")
            print("Screenshot taken successfully")

        except Exception as e:
            print(f"Verification failed: {e}")
            # Take a screenshot even on failure if possible to debug
            try:
                page.screenshot(path="verification/error_state.png")
            except Exception as screenshot_error:
                print(f"Failed to capture error state screenshot: {screenshot_error}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_export_feature()
