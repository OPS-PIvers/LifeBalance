
import time
from playwright.sync_api import sync_playwright

def verify_habits():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # We need a context with storage state to simulate login or just ignore it if we can access public
        # Since I don't have login credentials, I will try to visit the page.
        # But wait, the app is likely protected.
        # I'll check if I can just load the page. If it redirects to login, I might be stuck unless I can mock auth.
        # However, usually dev environment might have some way or I can at least see the login page.
        # Memory says: "Automated frontend verification (Playwright) of protected routes often times out or fails to render (white screen) due to missing Firebase Auth credentials in the test environment."

        # I will try to load the page and wait a bit.
        page = browser.new_page()

        # Setting viewport to mobile to simulate the environment
        page.set_viewport_size({"width": 375, "height": 812})

        try:
            page.goto("http://localhost:3000/#/habits")

            # Wait for some content to load.
            # If it redirects to login, we'll see the login page.
            time.sleep(5)

            # Take a screenshot
            page.screenshot(path="verification/habits_mobile.png")
            print("Screenshot taken at verification/habits_mobile.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_habits()
