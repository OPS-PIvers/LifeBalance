from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    # Mobile viewport as per memory instructions
    context = browser.new_context(viewport={"width": 390, "height": 844})

    # Set test mode session storage
    context.add_init_script("sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true');")

    page = context.new_page()

    print("Navigating to login...")
    # Login via test mode url
    page.goto("http://localhost:3000/#/login?test=true")

    # Wait for dashboard
    print("Waiting for dashboard...")
    try:
        page.wait_for_selector("text=Money Pulse", timeout=20000)
    except:
        print("Timeout waiting for Money Pulse. Dumping content:")
        # print(page.content())
        page.screenshot(path="verification_error.png")
        browser.close()
        return

    # Navigate to Budget
    print("Navigating to Budget...")
    page.goto("http://localhost:3000/#/budget")
    page.wait_for_selector("text=Buckets", timeout=10000)
    # Wait a bit for animations
    page.wait_for_timeout(1000)
    page.screenshot(path="verification_budget.png")
    print("Budget screenshot saved.")

    # Navigate to Habits
    print("Navigating to Habits...")
    page.goto("http://localhost:3000/#/habits")
    page.wait_for_selector("text=Daily Habits", timeout=10000)
    page.wait_for_timeout(1000)
    page.screenshot(path="verification_habits.png")
    print("Habits screenshot saved.")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
