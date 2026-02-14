
from playwright.sync_api import sync_playwright

def verify_buttons():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()

        # Capture console logs
        page.on("console", lambda msg: print(f"Console: {msg.text}"))
        page.on("pageerror", lambda exc: print(f"Page Error: {exc}"))

        print("Navigating to http://localhost:3000/#/login?test=true ...")
        try:
            page.goto("http://localhost:3000/#/login?test=true", timeout=60000)

            # Wait for something to appear
            try:
                page.wait_for_selector("#root", timeout=5000)
                print("Root element found.")

                # Wait for specific text that indicates the page loaded
                # Maybe "Sign in" or "Test Mode"
                # Since test=true, it should redirect or show a banner

                # Let's just wait a bit for any JS to execute
                page.wait_for_load_state('networkidle')

            except Exception as e:
                print(f"Wait failed: {e}")

            print("Taking screenshot...")
            page.screenshot(path="verification_dashboard_retry.png", full_page=True)
            print("Screenshot saved to verification_dashboard_retry.png")

        except Exception as e:
            print(f"Navigation failed: {e}")
            page.screenshot(path="verification_error_retry.png")

        browser.close()

if __name__ == "__main__":
    verify_buttons()
