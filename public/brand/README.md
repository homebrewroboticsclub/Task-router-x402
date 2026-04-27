# Brand assets (Homebrew Robotics mark)

- **`hbr-mark.png`** — white H mark on a transparent background (for dark UIs).
- **`apple-touch-icon.png`** — 180×180 PNG for `rel="apple-touch-icon"`.
- **`../favicon.ico`** — generated next to this folder; served at **`/favicon.ico`**.

Source artwork lives in **`temp/HBR.jpg`** (ignored by git). Regenerate after changing the logo:

```bash
npm run build:brand
```

Requires **`temp/HBR.jpg`**. The build script thresholds near-white pixels to alpha so the mark does not show a white box on dark headers.
