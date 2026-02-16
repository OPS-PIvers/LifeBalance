from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Navigate and Setup
        page.goto("http://localhost:3000/#/login")
        page.evaluate("window.sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true')")
        page.goto("http://localhost:3000/#/")

        page.wait_for_timeout(2000)

        # Navigate to Budget directly
        page.goto("http://localhost:3000/#/budget")
        page.wait_for_timeout(2000)

        # Click "Buckets" tab
        try:
            page.get_by_role("tab", name="Buckets").click()
        except:
             # Fallback if tabs aren't proper ARIA tabs (though they should be)
             page.click("button:has-text('Buckets')")

        page.wait_for_timeout(2000)
        page.screenshot(path="/home/jules/verification/budget_buckets.png")
        print("Buckets screenshot taken")

        # Click "Accounts" tab
        try:
            page.get_by_role("tab", name="Accounts").click()
        except:
             page.click("button:has-text('Accounts')")

        page.wait_for_timeout(2000)
        page.screenshot(path="/home/jules/verification/budget_accounts.png")
        print("Accounts screenshot taken")

        # Click "History" tab
        try:
             page.get_by_role("tab", name="History").click()
        except:
             page.click("button:has-text('History')")

        page.wait_for_timeout(2000)
        page.screenshot(path="/home/jules/verification/budget_history.png")
        print("History screenshot taken")

        browser.close()

if __name__ == "__main__":
    run()
