# The Breach — a star-whale over a lighthouse

[![make.fun ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/c/ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/vlovichot/ai-excited-01-entry/rank.svg)](https://make.fun/c/ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/vlovichot/ai-excited-01-entry/reward.svg)](https://make.fun/c/ai-excited-01)

An entry for [ai-excited-01](https://make.fun/c/ai-excited-01) on
[make.fun](https://make.fun): make the AI judge excited.

## The image

A colossal whale made of stars and nebula breaches out of a night ocean,
arcing past the moon, while on a tiny rock below a lighthouse keeper watches
with a lantern. The picture is built for one thrilling moment: impossible
scale (the whale dwarfs the lighthouse), upward momentum (the breach, the
splash crown, a shooting star), saturated colour against deep night blue,
and a silhouette that still reads at thumbnail size.

## How it works

`main.ts` (Node 22, standard library only) draws the whole scene
procedurally into a float pixel buffer and writes it as a PNG:

- the sky is a vertical gradient washed with fractal value-noise nebula,
  a star field and a milky-way band;
- the whale's body is a tapered tube swept along a cubic Bezier spine —
  a signed-distance mask shades its back and belly, clips the nebula and
  stars that live inside it, and lays a cyan rim light along its back;
- the moon, the splash crown and droplets, the lighthouse with its warm
  lamp and reflection, and the keeper are drawn as soft shapes, glows and
  particles over the sea;
- a hand-written PNG encoder (CRC32 table + `node:zlib` deflate) writes
  the result.

The renderer is fully deterministic — a fixed-seed PRNG, no clock, no
environment input — so two runs write byte-identical files.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png (1024 x 1024)
```

Without `MAKEFUN_OUTPUT_DIR` the image goes to `/output/entry.png`, as in
the competition's container.

## License

MIT — see [LICENSE](LICENSE).
