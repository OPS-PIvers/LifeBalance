from playwright.sync_api import Page, expect, sync_playwright

def verify_budget_calendar(page: Page):
    # 1. Login in Test Mode
    print("Navigating to login...")
    page.goto("http://localhost:3000/#/login?test=true")

    # Wait for dashboard (redirect/reload might happen)
    # Using a known text on the dashboard
    print("Waiting for dashboard...")
    expect(page.get_by_text("Hi,")).to_be_visible(timeout=30000)

    # 2. Navigate to Budget
    print("Navigating to Budget...")
    # Using the bottom nav link
    page.get_by_text("Budget", exact=True).click()

    # Wait for budget page content
    print("Verifying calendar visibility...")
    expect(page.get_by_text("Calendar", exact=True)).to_be_visible(timeout=10000)

    # Check for a specific element in BudgetCalendar to ensure it rendered
    # e.g., "Add Event" button
    expect(page.get_by_text("Add Event")).to_be_visible()

    # 4. Take Screenshot
    print("Taking screenshot...")
    page.screenshot(path="/home/jules/verification/budget_calendar.png")
    print("Screenshot saved.")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_budget_calendar(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="/home/jules/verification/error.png")
        finally:
            browser.close()
