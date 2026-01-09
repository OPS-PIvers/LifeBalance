
import asyncio
from playwright.async_api import async_playwright, expect

async def run():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Emulate iPhone 14 Pro which has Dynamic Island
        device = p.devices['iPhone 14 Pro']
        context = await browser.new_context(**device)
        page = await context.new_page()

        # Navigate to the app (running on default Vite port 5173 or 3000)
        # Memory says port 3000
        try:
            await page.goto("http://localhost:3000")
        except Exception:
            # Fallback if port differs
            await page.goto("http://localhost:5173")

        # Wait for the header to be visible
        header = page.locator("header")
        await expect(header).to_be_visible()

        # Take a screenshot of the top part of the screen
        await page.screenshot(path="verification/header_padding.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(run())
