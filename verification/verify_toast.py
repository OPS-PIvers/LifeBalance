import time
from playwright.sync_api import sync_playwright

def verify_toast_position():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Create a context with safe-area-inset-top environment if possible
        # Playwright doesn't easily mock env(safe-area-inset-top) in standard contexts without
        # device emulation, but we can verify the styles are applied.

        # Emulate iPhone 14 Pro which has safe area insets
        iphone_14_pro = p.devices['iPhone 14 Pro']
        context = browser.new_context(**iphone_14_pro)
        page = context.new_page()

        try:
            # Navigate to the app on port 3000
            page.goto('http://localhost:3000')

            # The app seems to be loading slow or maybe "Sign in" isn't the text.
            # Let's just wait for body to be visible
            page.wait_for_selector('body', timeout=10000)

            # We need to trigger a toast or just check the toaster container
            # Since Toaster is rendered in App.tsx, the container should be present in the DOM
            # The container usually has a class or style.
            # react-hot-toast creates a div.

            # Let's execute some JS to inspect the Toaster's container style
            # The toaster container is a direct child of body usually, or within the app div if it's rendered there.
            # In App.tsx it's inside the main div.

            # Let's try to find the toaster container. It typically has fixed position.
            # We can look for the style attribute we added.

            # Wait a bit for React to mount everything
            time.sleep(5)

            # Find any div with the specific top style
            toaster_container = page.locator('div[style*="safe-area-inset-top"]')

            count = toaster_container.count()
            print(f"Found {count} toaster containers with safe-area style.")

            if count > 0:
                print("Toaster container with correct style found!")
                # Take a screenshot to verify
                page.screenshot(path="verification/toaster_verification.png")
            else:
                print("Toaster container NOT found with exact style string.")
                # Dump all divs with style attribute to see what's there
                divs = page.locator('div[style]').all()
                for i, div in enumerate(divs):
                    style = div.get_attribute('style')
                    if 'fixed' in style and 'top' in style:
                        print(f"Candidate {i}: {style}")

            # Take a general screenshot
            page.screenshot(path="verification/general.png")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_toast_position()
