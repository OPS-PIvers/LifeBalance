
from playwright.sync_api import Page, expect, sync_playwright

def verify_toolbar_accessibility(page: Page):
    """
    Verifies that the TopToolbar elements are now accessible buttons.
    """
    # Capture console messages
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PageError: {err}"))

    # 1. Arrange: Go to the test page
    # Using the local dev server URL (Port 3001)
    page.goto("http://localhost:3001/#/test-toolbar")

    # Wait for the toolbar to be visible
    page.wait_for_selector("header")

    # 2. Assert: Check Safe to Spend button
    # It should be a button with the specific aria-label
    safe_spend_btn = page.locator("button[aria-label='View Safe to Spend details']")
    expect(safe_spend_btn).to_be_visible()

    # Check if it has the click handler working (open modal)
    safe_spend_btn.click()
    # Expect modal to open (look for text inside the modal)
    expect(page.get_by_text("Safe to Spend Breakdown")).to_be_visible()

    # Reload to close modal and reset
    page.reload()

    # 3. Assert: Check Points Cluster button
    points_btn = page.locator("button[aria-label='View Rewards and Points breakdown']")
    expect(points_btn).to_be_visible()

    # Focus on it to show focus ring (for screenshot)
    points_btn.focus()

    # 4. Screenshot
    page.screenshot(path="verification/toolbar_accessibility.png")
    print("Screenshot saved to verification/toolbar_accessibility.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_toolbar_accessibility(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_screenshot.png")
        finally:
            browser.close()
