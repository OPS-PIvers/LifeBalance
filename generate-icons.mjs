import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceIcon = join(__dirname, 'public', 'lifebalance_icon.png');
const publicDir = join(__dirname, 'public');

const sizes = [
  { name: 'apple-touch-icon.png', size: 180 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 }
];

async function generateIcons() {
  console.log('Generating icons from:', sourceIcon);

  for (const { name, size } of sizes) {
    const outputPath = join(publicDir, name);
    await sharp(sourceIcon)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 248, g: 250, b: 252, alpha: 1 }
      })
      .png()
      .toFile(outputPath);
    console.log(`✓ Generated ${name} (${size}x${size})`);
  }

  console.log('\nAll icons generated successfully!');
}

generateIcons().catch(console.error);
