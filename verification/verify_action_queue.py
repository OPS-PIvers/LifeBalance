from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 375, "height": 667})
        page = context.new_page()

        print("Navigating to login...")
        page.goto("http://localhost:3000/#/login?test=true")
        page.wait_for_timeout(2000)

        print("Navigating to Dashboard...")
        page.goto("http://localhost:3000/#/")
        page.wait_for_timeout(2000)

        # check if action queue is empty
        # If so, add a transaction
        print("Opening Capture Modal to add transaction...")
        try:
             page.get_by_label("Add Transaction").click()
        except Exception:
             print("FAB not found? Maybe already on modal?")

        # Switch to Manual Entry (Money icon)
        print("Switching to Manual Entry...")
        page.get_by_role("button", name="Manual Entry").click()

        # Fill form
        print("Filling form...")
        page.get_by_label("Amount").fill("12.34")
        page.get_by_label("Merchant").fill("Test Merchant")
        page.get_by_label("Date").fill("2025-01-01") # Future date to ensure pending? Or past date?
        # If past date, verified status?
        # CaptureModal logic: status: isFuture ? 'pending_review' : 'verified'
        # Wait, manual entry: "Manual entries update your budget immediately without review."
        # The text says: "Instant = updates budget immediately".
        # But `addTransaction` logic:
        # const isFuture = transactionDate > getLocalDateString();
        # status: isFuture ? 'pending_review' : 'verified',

        # So I need a future date to make it pending review (Action Queue).
        page.get_by_label("Date").fill("2026-01-01")

        # Select category
        # There might be buttons for category
        # Just pick the first one
        page.get_by_role("radiogroup", name="Category").get_by_role("button").first.click()

        print("Saving transaction...")
        page.get_by_role("button", name="Save Transaction").click()

        # Wait for modal to close and dashboard to update
        page.wait_for_timeout(2000)

        # Check Action Queue
        print("Checking Action Queue...")
        expect(page.get_by_text("Action Queue")).to_be_visible()
        expect(page.get_by_text("Test Merchant")).to_be_visible()

        # Expand item
        print("Expanding item...")
        page.get_by_role("button", name="Review").first.click()

        # Take screenshot of expanded item to verify buttons stacking
        print("Taking screenshot...")
        page.screenshot(path="verification/action_queue_mobile.png")

        browser.close()
        print("Done.")

if __name__ == "__main__":
    run()
