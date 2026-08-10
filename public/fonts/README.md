# Fonts

All three are SIL Open Font License and self-hosted — no CDN request, which
keeps the render path free of a third-party round trip and avoids leaking
visitors to a font host.

| Role | Family | Source |
|------|--------|--------|
| Display | **Mattone** | https://www.collletttivo.it/typefaces/mattone |
| Body | **Hanken Grotesk** | https://fonts.google.com/specimen/Hanken+Grotesk |
| Mono | **Sligoil** | https://velvetyne.fr/fonts/sligoil/ |

Download, subset to Latin, and convert to woff2:

```sh
pip install fonttools brotli
pyftsubset Mattone-Regular.otf \
  --unicodes="U+0000-00FF,U+2010-2027,U+2030-205E" \
  --layout-features="kern,liga" \
  --flavor=woff2 --output-file=Mattone-Regular.woff2
```

Filenames must match `src/styles/type.css`. Binaries are gitignored; keep the
originals and licence files wherever you archive project assets.

## Alternate display

**Gulax** (Velvetyne, OFL, single weight) if you want the hero louder. Monoline
with a large x-height and short extenders, which suits carving, but only one
weight and a more experimental voice.
