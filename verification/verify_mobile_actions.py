from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use iPhone SE viewport
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        print("Navigating to login...")
        # Navigate to login with test mode
        page.goto("http://localhost:3000/#/login?test=true")

        # Wait for dashboard to load
        print("Waiting for dashboard...")
        expect(page.get_by_text("Test Mode")).to_be_visible(timeout=10000)

        # Navigate to Meals
        print("Navigating to Meals...")
        page.goto("http://localhost:3000/#/meals")

        # Wait for "Weekly Plan" text
        expect(page.get_by_text("Weekly Plan")).to_be_visible()

        # Find the first "Add Meal" button
        print("Adding a meal...")
        add_buttons = page.get_by_role("button", name="Add Meal")
        # Ensure at least one exists
        expect(add_buttons.first).to_be_visible()
        add_buttons.first.click()

        # Fill Modal
        expect(page.get_by_role("dialog")).to_be_visible()

        # Fill "Meal Name"
        page.get_by_placeholder("e.g. Adobo Chicken & Rice").fill("Flux Burger")

        # Click "Save to Plan"
        page.get_by_role("button", name="Save to Plan").click()

        # Wait for "Flux Burger" to appear
        print("Waiting for meal to appear...")
        expect(page.get_by_text("Flux Burger")).to_be_visible()

        # Now, verify the "More" button
        print("Verifying More button...")
        more_button = page.get_by_role("button", name="More options").first
        expect(more_button).to_be_visible()

        # Click it
        more_button.click()

        # Verify Drawer Opens
        print("Verifying Drawer...")
        drawer = page.get_by_role("dialog").last # Last dialog should be the drawer
        expect(drawer).to_be_visible()
        expect(drawer).to_contain_text("Flux Burger") # Title

        # Verify actions
        expect(page.get_by_role("button", name="Edit Meal")).to_be_visible()
        expect(page.get_by_role("button", name="Remove from Plan")).to_be_visible()

        # Click "Remove from Plan" to test the action and clean up
        print("Verifying remove action and cleaning up...")
        page.get_by_role("button", name="Remove from Plan").click()

        # Verify the drawer closes and the item is gone
        expect(drawer).not_to_be_visible()
        expect(page.get_by_text("Flux Burger")).not_to_be_visible()

        # Screenshot
        page.screenshot(path="verification/verification.png")
        print("Verification successful, screenshot saved.")

        browser.close()

if __name__ == "__main__":
    run()
