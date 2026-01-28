
from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # 1. Login in Test Mode
    print("Navigating to login...")
    page.goto("http://localhost:3000/#/login?test=true")

    # Wait for dashboard or redirection
    print("Waiting for dashboard...")
    page.wait_for_timeout(3000) # Wait for auth to settle

    # 2. Go to Shopping List
    print("Navigating to Shopping List...")
    page.goto("http://localhost:3000/#/shopping")

    # 3. Add an item if list is empty (Test mode might have items)
    # Check if list is empty
    page.wait_for_timeout(1000)

    print("Adding item...")
    # Find input with placeholder "Add item..."
    input_field = page.get_by_placeholder("Add item")
    input_field.fill("Apples")
    input_field.press("Enter")

    page.wait_for_timeout(1000)

    # 4. Click Save as Template
    print("Clicking Save as Template...")
    # Button with title "Save as Template"
    save_btn = page.locator("button[title='Save as Template']")
    expect(save_btn).to_be_enabled()
    save_btn.click()

    # 5. Verify Modal
    print("Verifying Modal...")
    # Check for "New Template" text
    expect(page.get_by_text("New Template")).to_be_visible()

    # Check if "Apples" is in the list of items (it might be in the list below)
    # The modal shows all items, selected ones have a checkmark
    # We can just take a screenshot of the modal

    page.wait_for_timeout(1000)
    print("Taking screenshot...")
    page.screenshot(path="verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
