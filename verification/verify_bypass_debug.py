from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        # Listen for console logs
        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        try:
            print("Navigating to login with bypass...")
            page.goto("http://localhost:3000/#/login?bypass=true")

            print("Waiting for dashboard redirect...")

            # Allow some time for things to settle even if it fails
            page.wait_for_timeout(5000)

            # Check if we are still on login or redirected
            print(f"Current URL: {page.url}")

            expect(page.get_by_text("TEST MODE ENABLED")).to_be_visible(timeout=5000)
            print("Test Mode Banner found!")

            page.screenshot(path="verification/bypass_success.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/bypass_debug_error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
