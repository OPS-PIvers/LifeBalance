from playwright.sync_api import sync_playwright, expect
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use mobile viewport to verify responsive design
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()

        try:
            print("Navigating to Test Mode login...")
            page.goto("http://localhost:3000/#/login?test=true")

            # Wait for dashboard to load (look for 'Safe to Spend' or header)
            print("Waiting for dashboard...")
            expect(page.get_by_text("Safe to Spend")).to_be_visible(timeout=10000)

            # Locate Horizon Command Bar input
            print("Locating Horizon Command Bar...")
            input_field = page.get_by_placeholder("Ask Horizon or type '$20 Pizza'...")
            expect(input_field).to_be_visible()

            # Interact: Type "$20 Pizza"
            print("Typing heuristic...")
            input_field.fill("$20 Pizza")

            # Wait for suggestion
            print("Waiting for suggestion...")
            suggestion = page.get_by_text("Log $20.00 to Dining") # Assuming 'Pizza' matches Dining/Food bucket in test data?
            # Or just wait for any suggestion pill
            pill = page.locator("button").filter(has_text="Log $20.00")
            expect(pill).to_be_visible(timeout=5000)

            print("Taking screenshot...")
            page.screenshot(path="verification/horizon_bar.png")
            print("Screenshot saved to verification/horizon_bar.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
