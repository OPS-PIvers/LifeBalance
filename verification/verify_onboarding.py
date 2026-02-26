from playwright.sync_api import sync_playwright
import time

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        url = "http://127.0.0.1:3000/#/login"
        print(f"Navigating to {url}...")

        try:
            page.goto(url, timeout=30000)
            print("Loaded page, waiting for content...")
            time.sleep(5) # Generous wait

            page.screenshot(path="verification_login.png")
            print("Login screenshot taken.")

        except Exception as e:
            print(f"Error: {e}")

        browser.close()

if __name__ == "__main__":
    run()
