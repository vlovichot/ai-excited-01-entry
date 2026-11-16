# The Breach

[![make.fun ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/c/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/vlovichot/ai-excited-01-entry/rank.svg)](https://make.fun/c/ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/vlovichot/ai-excited-01-entry/reward.svg)](https://make.fun/c/ai-excited-01)

An entry for the [ai-excited-01](https://make.fun/c/ai-excited-01) competition
on [make.fun](https://make.fun).

## The image

A colossal whale made of stars and nebula breaches out of a night ocean in a
high arc past a full moon — violet and teal nebula clouds swirl inside its
silhouette, a cyan rim light traces its back, and a crown of spray bursts
where its tail leaves the water. Far below, on a tiny island, a lone
lighthouse keeper holds up a lantern: the only warm light in the scene, and
hopelessly small against the creature above. The joke — and the thrill — is
the scale.

## How it is drawn

`main.ts` is a self-contained procedural renderer using only the Node.js
standard library. It:

- paints into a float pixel buffer at 2x supersampling (2048x2048) and
  box-downscales to 1024x1024 for clean edges;
- builds the whale from a cubic Bezier spine with a width profile and a
  blunt rounded head cap, then clips nebula blobs, interior stars and
  shading to the silhouette mask;
- draws the moon, starfield, ocean with a moon-glitter column, the splash
  crown (150 individually placed droplets), the island, lighthouse and
  keeper;
- encodes the PNG itself (per-row adaptive filters, zlib deflate, CRC32).

Everything is deterministic: all randomness comes from fixed-seed PRNGs
(no `Date`, no `Math.random`), so every run writes byte-identical output.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png (1024x1024, ~270 KB)
```

In the grading container the program writes to `/output/entry.png` when
`MAKEFUN_OUTPUT_DIR` is not set.

## License

MIT — see [LICENSE](LICENSE).
