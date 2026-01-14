from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 375, 'height': 812})
    page = context.new_page()

    # Listen to console logs
    page.on("console", lambda msg: print(f"Browser console: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"Browser error: {exc}"))

    try:
        page.goto('http://localhost:3000/#/login?test=true')

        # Wait a bit to see if anything loads
        page.wait_for_timeout(5000)

        page.screenshot(path='verification/debug_console.png')

        # Try to find the Budget link more robustly
        # It's in the BottomNav, labeled "Budget"
        # We can look for the text "Budget"
        budget_link = page.get_by_text("Budget")
        if budget_link.count() > 0:
            budget_link.first.click()
        else:
            print("Budget link not found via text, trying icon/href")
            # The href is /budget but it's a NavLink
            page.click('a[href="/budget"]')

        # Wait for "History" button
        page.wait_for_selector('button:has-text("History")')
        page.click('button:has-text("History")')

        page.wait_for_selector('input[placeholder="Search merchant or amount..."]')
        page.screenshot(path='verification/transaction_history.png')

    except Exception as e:
        print(f"Script failed: {e}")
        page.screenshot(path='verification/error_state.png')

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
