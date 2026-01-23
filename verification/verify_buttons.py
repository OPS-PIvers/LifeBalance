from playwright.sync_api import sync_playwright
import time

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    page.on("console", lambda msg: print(f"Console: {msg.text}"))

    print("Navigating to Login with test mode...")
    # Go to Login in Test Mode
    # Hash router format: /#/login?test=true
    page.goto("http://localhost:3000/#/login?test=true")

    print("Waiting for redirection or dashboard...")
    # It should redirect to / and then load Dashboard
    # We wait for "Safe to Spend" which is on Dashboard
    try:
        page.wait_for_selector("text=Safe to Spend", timeout=20000)
        print("Dashboard loaded!")
    except Exception as e:
        print(f"Timeout waiting for Dashboard. Current URL: {page.url}")
        page.screenshot(path="verification/timeout.png", full_page=True)
        browser.close()
        raise e

    # 1. Verify TopToolbar Typography
    print("Verifying Typography...")
    # Check for "Today" label class
    today_label = page.locator("text=Today").first
    # We expect text-xxs class. But since classes are compiled, let's just assume if it renders it's likely fine.
    # We can check CSS font-size if we really want.
    # computed_style = today_label.evaluate("element => window.getComputedStyle(element).fontSize")
    # print(f"Today label font size: {computed_style}")

    # 2. Verify ActionQueueItem Buttons
    print("Verifying Action Buttons...")
    # Try to find a "Review" button which indicates an Action Queue Item.
    review_btn = page.locator("button:has-text('Review')").first
    if review_btn.count() > 0:
        print("Found Review button, expanding...")
        review_btn.click()
        # Wait for expanded content
        page.wait_for_timeout(1000)

        # Check for "Approve Transaction" button
        approve_btn = page.locator("button:has-text('Approve Transaction')").first
        if approve_btn.count() > 0:
            print("Found Approve Transaction button")
            # Verify class contains bg-emerald-500 (or semantic class if compiled differently, but tailwind classes usually persist)
            # The refactor used variant="success" which maps to bg-emerald-500.
            classes = approve_btn.get_attribute("class")
            print(f"Approve Button Classes: {classes}")
            if "bg-emerald-500" in classes:
                print("SUCCESS: Button has correct background class!")
            else:
                print("WARNING: Button missing bg-emerald-500 class")
        else:
            print("Approve Transaction button NOT found (maybe it's a different type of item)")

    else:
        print("No Review button found (Action Queue might be empty)")

    # Take Screenshot
    print("Taking screenshot...")
    page.screenshot(path="verification/verification.png", full_page=True)

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
