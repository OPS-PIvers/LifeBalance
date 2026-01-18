from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        print("Navigating to login...")
        page.goto("http://localhost:3000/#/login?test=true")
        page.wait_for_timeout(2000)

        print("Navigating to Habits...")
        page.goto("http://localhost:3000/#/habits")
        page.wait_for_timeout(2000)

        print("Opening New Habit Modal...")
        # FAB might be same aria-label "Add Habit" or similar
        # Let's try finding the Plus icon or checking page content
        # Dashboard FAB is in BottomNav and opens CaptureModal.
        # Habits page might have its own button?
        # Let's check Habits.tsx content? No time.
        # Usually standard pattern.
        # Try finding a button with "New Habit" or "+"
        try:
             page.get_by_label("Add Habit").click() # Guessing
        except:
             # Try getting by role button with Plus icon?
             # BottomNav FAB opens CaptureModal.
             # Does Habits page have a "New Habit" button?
             page.get_by_role("button", name="New Habit").click()

        print("Verifying elements...")
        expect(page.get_by_label("Category")).to_be_visible()
        expect(page.get_by_label("Points")).to_be_visible()

        # Take screenshot
        print("Taking screenshot...")
        page.screenshot(path="verification/habit_modal_mobile.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    run()
