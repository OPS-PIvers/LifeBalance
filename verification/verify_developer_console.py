from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
        page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))

        print("Navigating to login...")
        page.goto("http://localhost:3000/#/login?test=true")
        page.wait_for_timeout(2000)

        print("Navigating to Settings...")
        page.goto("http://localhost:3000/#/settings")
        page.wait_for_timeout(1000)

        print("Clicking Developer Console button...")
        try:
             page.get_by_role("button", name="Developer Console").click()
        except Exception as e:
             print(f"Failed to click button: {e}")
             page.screenshot(path="verification/failed_to_find_button.png")
             browser.close()
             return

        print("Button clicked. Waiting 2s...")
        page.wait_for_timeout(2000)

        # Take interim screenshot
        page.screenshot(path="verification/dev_console_open_attempt.png")

        # Verify modal is open and "Add Tester" input is visible
        print("Verifying elements...")
        try:
            expect(page.get_by_placeholder("new@tester.com")).to_be_visible(timeout=5000)
            expect(page.get_by_role("button", name="Add Tester")).to_be_visible()
            print("Elements found.")
        except Exception as e:
            print(f"Elements not found: {e}")

        # Take screenshot
        print("Taking final screenshot...")
        page.screenshot(path="verification/developer_console_mobile.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    run()
