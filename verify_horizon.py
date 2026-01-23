from playwright.sync_api import sync_playwright

def verify_horizon(page):
    # Go to test mode login
    print("Navigating to login...")
    page.goto("http://localhost:3000/#/login?test=true")

    # Wait for dashboard to load (look for "Hi, Test User")
    print("Waiting for dashboard...")
    page.wait_for_selector("text=Hi, Test User", timeout=10000)

    # Wait for Horizon Command Bar input
    print("Looking for Horizon input...")
    input_selector = "input[placeholder*='Ask Horizon']"
    page.wait_for_selector(input_selector)

    # Type into it
    page.fill(input_selector, "Buy Milk")

    # Take screenshot
    print("Taking screenshot...")
    page.screenshot(path="horizon_verification.png")
    print("Screenshot saved to horizon_verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            verify_horizon(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="error.png")
        finally:
            browser.close()
