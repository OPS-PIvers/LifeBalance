from playwright.sync_api import Page, expect, sync_playwright

def verify_mobile_todos(page: Page):
    # Set viewport to mobile
    page.set_viewport_size({"width": 375, "height": 667})

    print("Navigating to login in test mode...")
    page.goto("http://0.0.0.0:3000/#/login?test=true")

    # Wait for dashboard
    print("Waiting for dashboard...")
    expect(page.get_by_text("Test User")).to_be_visible(timeout=10000)

    # Navigate to Todos
    print("Navigating to Todos page...")
    page.goto("http://0.0.0.0:3000/#/todos")

    # Wait for Todos page title
    expect(page.get_by_role("heading", name="To-Do List")).to_be_visible()

    # Create a new task since mock data is empty
    print("Creating a new task...")
    page.get_by_label("Add new task").click()

    # Fill form
    page.get_by_placeholder("Enter task description").fill("Test Mobile Drawer")
    page.get_by_text("Create Task").click()

    # Wait for task to appear
    print("Waiting for task to appear...")
    expect(page.get_by_text("Test Mobile Drawer").first).to_be_visible()

    # Find the "More options" button
    print("Finding More options button...")
    more_button = page.get_by_label("More options").first
    expect(more_button).to_be_visible()

    # Click it
    print("Clicking More options...")
    more_button.click()

    # Verify Drawer opens
    print("Verifying Drawer...")
    dialog = page.get_by_role("dialog")
    expect(dialog).to_be_visible()

    # Verify title in drawer
    expect(dialog.get_by_text("Test Mobile Drawer")).to_be_visible()

    # Verify actions
    expect(dialog.get_by_text("Complete Task")).to_be_visible()
    expect(dialog.get_by_text("Edit Task")).to_be_visible()

    # Wait a bit for animation
    page.wait_for_timeout(1000)

    # Screenshot
    print("Taking screenshot...")
    page.screenshot(path="/home/jules/verification/todos_mobile_drawer.png")
    print("Screenshot saved.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_mobile_todos(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()
