from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        print("Navigating to login...")
        page.goto("http://localhost:3000/#/login?test=true")

        print("Waiting...")
        try:
            page.wait_for_url("**/#/", timeout=5000)
        except Exception as e:
            print(f"Wait failed. Current URL: {page.url}")
            # Try to force navigation if stuck?
            # Or maybe we are already there.

        print(f"Current URL: {page.url}")

        if "/login" in page.url:
             print("Still on login page. Checking for content...")
             print(page.content())

        # Open Capture Modal via FAB
        print("Opening Capture Modal...")
        page.get_by_label("Add Transaction").click()

        # Switch to Shopping Tab
        print("Switching to Shop tab...")
        page.get_by_role("button", name="Shop").click()

        # Assertions
        print("Verifying elements...")
        expect(page.get_by_label("Category")).to_be_visible()
        expect(page.get_by_label("Quantity")).to_be_visible()

        # Take screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification/capture_modal_mobile.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    run()
