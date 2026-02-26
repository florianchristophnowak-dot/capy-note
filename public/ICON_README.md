# Icon Generation Guide

The app needs icons in different formats for each platform:

## Required formats:
- `icon.png` - 512x512 PNG (universal)
- `icon.ico` - Windows icon (multiple sizes embedded)
- `icon.icns` - macOS icon

## Quick generation using online tools:

1. **Use the SVG**: Open `icon.svg` in a browser and take a 512x512 screenshot
   
2. **Online converters**:
   - PNG to ICO: https://convertico.com/ or https://icoconvert.com/
   - PNG to ICNS: https://cloudconvert.com/png-to-icns

3. **Place the files**:
   ```
   public/
   ├── icon.svg    (source)
   ├── icon.png    (512x512)
   ├── icon.ico    (Windows)
   └── icon.icns   (macOS)
   ```

## Using ImageMagick (command line):

```bash
# Install ImageMagick first
# Windows: choco install imagemagick
# macOS: brew install imagemagick
# Linux: sudo apt install imagemagick

# Convert SVG to PNG
magick convert -background none -density 512 icon.svg -resize 512x512 icon.png

# Create Windows ICO (multiple sizes)
magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# Create macOS ICNS (requires iconutil on Mac)
mkdir icon.iconset
magick convert icon.png -resize 16x16 icon.iconset/icon_16x16.png
magick convert icon.png -resize 32x32 icon.iconset/icon_16x16@2x.png
magick convert icon.png -resize 32x32 icon.iconset/icon_32x32.png
magick convert icon.png -resize 64x64 icon.iconset/icon_32x32@2x.png
magick convert icon.png -resize 128x128 icon.iconset/icon_128x128.png
magick convert icon.png -resize 256x256 icon.iconset/icon_128x128@2x.png
magick convert icon.png -resize 256x256 icon.iconset/icon_256x256.png
magick convert icon.png -resize 512x512 icon.iconset/icon_256x256@2x.png
magick convert icon.png -resize 512x512 icon.iconset/icon_512x512.png
magick convert icon.png -resize 1024x1024 icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset
```

## Temporary workaround:

If you don't have icons ready, the build will still work but may show a default icon.
You can add proper icons later and rebuild.
