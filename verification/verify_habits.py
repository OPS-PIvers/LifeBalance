
from playwright.sync_api import Page, expect, sync_playwright

def verify_habits_page(page: Page):
    # Enable Test Mode to bypass login
    page.goto("http://localhost:3000/")

    # Inject session storage for test mode
    page.evaluate("sessionStorage.setItem('LIFEBALANCE_TEST_MODE', 'true')")

    # Reload to apply test mode
    page.reload()

    # Navigate to Habits page (Test mode might land on Dashboard, so click nav or goto)
    page.goto("http://localhost:3000/#/habits")

    # Wait for habits to load (look for a category header or a habit card)
    # Assuming 'Daily Habits' header or category names like 'Health'
    expect(page.get_by_text("Daily Habits")).to_be_visible(timeout=10000)

    # Wait for at least one habit card
    # HabitCard has "relative flex items-center justify-between p-4 rounded-card border shadow-soft transition-all duration-300 select-none group/card"
    # We look for the parent Reorder.Item.

    # Let's just take a screenshot first to see where we are
    page.screenshot(path="/app/verification/habits_page_initial.png")

    # Check if we have any habits. If mock data provides habits, we should see them.
    # The MockHouseholdContext usually provides some default data.

    # Find a Reorder Item. We can look for the GripVertical icon or just the item structure.
    # The drag handle has "cursor-grab".

    drag_handle = page.locator(".cursor-grab").first
    if drag_handle.is_visible():
        print("Found drag handle.")
        # The Reorder.Item is the parent of the parent of the drag handle (roughly).
        # HabitCard structure:
        # Reorder.Item -> HabitCard -> ... -> dragHandle

        # Actually Reorder.Item wraps HabitCard.
        # <Reorder.Item ...> <HabitCard ... dragHandle={...} /> </Reorder.Item>

        # Let's find the Reorder.Item element.
        # Since I removed "touch-none" from it, I want to verify it DOES NOT have "touch-none".

        # We can find the element that contains the HabitCard.
        # HabitCard has class "rounded-card".
        habit_card = page.locator(".rounded-card").first
        reorder_item = habit_card.locator("..") # Parent should be Reorder.Item

        # Check class attribute of reorder_item
        classes = reorder_item.get_attribute("class")
        print(f"Classes on Reorder.Item: {classes}")

        if classes and "touch-none" in classes:
             raise Exception("FAIL: touch-none class still present on Reorder.Item")
        else:
             print("SUCCESS: touch-none class NOT present on Reorder.Item")

    else:
        print("No drag handle found - maybe no habits?")

    # Take final screenshot
    page.screenshot(path="/app/verification/habits_page_verified.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_habits_page(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/app/verification/error.png")
            raise
        finally:
            browser.close()
