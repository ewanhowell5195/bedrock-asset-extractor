# bedrock-asset-extractor

Dumps the complete Minecraft Bedrock assets from your installed copy of the game, as one flat, readable pack per family.

**Check [Mojang/bedrock-samples](https://github.com/Mojang/bedrock-samples/releases) first.** Mojang publish the vanilla resource and behavior packs there already unpacked, one release per version. If the version you want is there, just grab it, it's simpler than running this. Use this when it isn't: the releases lag behind, and only vanilla is published, so anything newer than the latest release or outside vanilla has to come off your own install.

Bedrock doesn't ship its assets in a usable state. Two things get in the way:

- **Diff chains.** The vanilla pack is a base plus a chain of per-version diff packs (`vanilla`, `vanilla_base`, `vanilla_1.26.50`, ...) that all share one pack UUID. Each versioned folder only contains the files *that version changed*, so no single folder is the game.
- **`.brarchive` containers.** Most of the real content is packed into `__brarchive/**.brarchive` blobs rather than sitting on disk as files.

This resolves the chain in version order (later pack wins per path), unpacks the containers, and writes the result out as a normal folder tree.

## Usage

```bash
node index.js
```

```
--rel=preview     use the Preview install; ERRORS if it isn't installed
--rel=release     use the retail install; ERRORS if it isn't installed
--rel=both        do BOTH editions (vanilla pack only)
--rel=all         do BOTH editions and dump EVERY pack, not just vanilla
(no --rel)        release first, falling back to preview

--dir=<path>      explicit install dir (game root or its Content dir)
--out=<path>      output directory (default: ./output)
--help
```

`--dir` pins which install is used, so it overrides the edition part of `--rel`. `--rel=all` keeps its other meaning either way: dump every pack, not just vanilla.

## Output

Default and `--rel=both`:

```
resource_packs/minecraft_<edition>_<version>/
behavior_packs/minecraft_<edition>_<version>/
```

`--rel=all`, which keeps the packs separate since they aren't all one game:

```
resource_packs/minecraft_<edition>_<version>_all/
  vanilla/            <- 56 packs merged
  chemistry/          <- 8 packs merged
  experimental_y_2026_drop_1/
  ...
behavior_packs/minecraft_<edition>_<version>_all/
skin_packs/minecraft_<edition>_<version>_all/
```

Chain grouping is automatic: anything matching `<base>_<dotted.version>` is treated as a diff of `<base>`, so `chemistry_1.20.60` merges into `chemistry` while `experimental_y_2026_drop_1` (no dotted version) stays standalone. `contents.json` is dropped since it's a per-pack file listing that means nothing once merged.

## Default Paths

```
C:\XboxGames\Minecraft for Windows          // release
C:\XboxGames\Minecraft Preview for Windows  // preview
```