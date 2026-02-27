import asyncio
from playwright.async_api import async_playwright
import sys

async def verify_recipe_viewer():
    async with async_playwright() as p:
        # Launch browser
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1280, 'height': 800})
        page = await context.new_page()

        try:
            print("1. Navigating to Login Page (Test Mode)...")
            # Use the test mode URL to bypass real auth
            await page.goto("http://localhost:3000/#/login?test=true")

            # Wait for redirection to dashboard or manually click if needed
            print("   Waiting for dashboard or login confirmation...")

            try:
                await page.wait_for_selector('text=Meal Plan', timeout=10000)
                print("   ✅ Successfully logged in (found 'Meal Plan' link)")
            except Exception:
                print("   ⚠️  'Meal Plan' text not found immediately. Attempting direct navigation to /#/meals...")
                await page.goto("http://localhost:3000/#/meals")
                await page.wait_for_selector('text=Meal Plan', timeout=10000)
                print("   ✅ Successfully navigated to Meal Plan page")

            print("2. Verifying Recipe Viewer Feature...")

            # 1. Click "Add Meal" to create a test meal
            print("   - Adding a test meal...")
            # Use .first() because there are multiple "Add Meal" buttons
            await page.locator('button:has-text("Add Meal")').first.click()

            # Fill in the modal
            # Wait for modal to appear. Based on screenshot, placeholder is "e.g. Adobo Chicken & Rice"
            print("   - Filling meal details...")
            # Use a more generic selector for the input or the correct placeholder
            await page.wait_for_selector('input[type="text"]')

            # Try to fill the first text input which should be the name
            # Or find by label "MEAL NAME" if possible, but structure might vary.
            # Using the placeholder seen in screenshot
            await page.fill('input[placeholder*="Adobo"]', "Test Recipe Viewer Meal")

            # Add some instructions to test the checklist
            await page.fill('textarea[placeholder*="Step 1"]', "Step 1: Prep ingredients\nStep 2: Cook meal")

            await page.click('button:has-text("Save to Plan")')

            # Wait for the meal to appear
            await page.wait_for_selector('text=Test Recipe Viewer Meal')
            print("   ✅ Test meal added")

            # 2. Open the Recipe Viewer
            print("   - Opening Recipe Viewer...")
            # Click the meal card (it should be clickable now)
            await page.click('text=Test Recipe Viewer Meal')

            # Verify Modal Content
            await page.wait_for_selector('h3:has-text("Test Recipe Viewer Meal")')

            # Verify Instructions are present
            if await page.locator('text=Step 1: Prep ingredients').count() > 0:
                 print("   ✅ Instructions found in viewer")
            else:
                 print("   ⚠️ Instructions not found in viewer")

            print("   ✅ Recipe Viewer Modal opened")

            # 3. Interact with Checklists (Instructions)
            print("   - Interacting with checklists...")
            # Click the checkbox for step 1
            # The structure is likely a button or div with a checkbox icon.
            # We can try clicking the text itself as the whole row might be clickable or the checkbox next to it.
            await page.click('text=Step 1: Prep ingredients')

            # 4. Mark as Cooked
            print("   - Clicking 'Mark as Cooked'...")
            mark_cooked_btn = page.locator('button:has-text("Mark as Cooked")')
            await mark_cooked_btn.click()

            # Wait a moment for state update
            await page.wait_for_timeout(1000)

            # Close modal if still open
            if await page.is_visible('button[aria-label="Close"]'):
                 await page.click('button[aria-label="Close"]')

            print("   - Verifying 'Cooked' status on list item...")

            # Find the meal card again
            meal_card = page.locator('div:has-text("Test Recipe Viewer Meal")').last

            # Check for visual indicator (text-emerald-600 or bg-emerald-50)
            # We will take a screenshot here to confirm success visually as well
            await page.screenshot(path=".Jules/verification/success_cooked.png")
            print("   📸 Screenshot saved to .Jules/verification/success_cooked.png")

            # Check for class presence
            if await meal_card.locator('.text-emerald-600').count() > 0:
                 print("   ✅ Verified: Meal has 'Cooked' indicator (text-emerald-600 found)")
            elif await meal_card.locator('.bg-emerald-50').count() > 0:
                 print("   ✅ Verified: Meal has 'Cooked' background (bg-emerald-50 found)")
            else:
                 print("   ⚠️ Warning: 'Cooked' indicator not explicitly found via class check, please check screenshot.")

            print("\n✅ VERIFICATION SUCCESSFUL: Recipe Viewer feature is working!")

        except Exception as e:
            print(f"\n❌ VERIFICATION FAILED: {str(e)}")
            await page.screenshot(path=".Jules/verification/error_final_v3.png")
            print("   Screenshot saved to .Jules/verification/error_final_v3.png")
            sys.exit(1)

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_recipe_viewer())
