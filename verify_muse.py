from playwright.sync_api import sync_playwright

def verify_muse_polish():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use a larger viewport to ensure desktop view or standard mobile
        page = browser.new_page(viewport={"width": 375, "height": 812}) # iPhone X size for mobile-first

        try:
            # 1. Login Page Polish Verification
            print("Navigating to Login Page...")
            page.goto("http://localhost:3000/#/login")
            # Wait for "Sign in to continue" text to appear
            try:
                page.get_by_text("Sign in to continue").wait_for(timeout=5000)
            except TimeoutError:
                # Fallback if text changed or not found immediately, wait for network idle
                page.wait_for_load_state("networkidle")

            # Wait for page to be fully loaded and styled
            page.wait_for_load_state("networkidle")

            print("Capturing Login Screenshot...")
            page.screenshot(path="login_polish.png")

            # 2. Enter Test Mode & Verify Dashboard
            print("Entering Test Mode...")
            page.goto("http://localhost:3000/#/login?test=true")

            # Wait for "Dashboard" or some home element.
            # BottomNav should be visible.
            page.get_by_text("Home", exact=True).wait_for()

            # 3. Open Capture Modal
            print("Opening Capture Modal...")
            page.get_by_label("Add Transaction").click()

            # Wait for "Add Transaction" title in the modal header
            page.get_by_role("heading", name="Add Transaction").wait_for()

            # Wait for the "Expense", "To-Do", "Shop" tabs
            page.get_by_text("Expense").wait_for()

            # Wait for modal animations to complete
            page.wait_for_timeout(1000)

            print("Capturing Capture Modal Screenshot...")
            page.screenshot(path="capture_modal_polish.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="error.png")
            raise e
        finally:
            browser.close()
            print("Verification complete.")

if __name__ == "__main__":
    verify_muse_polish()
