import fs from "node:fs"
import path from "node:path"

const MAGIC = Buffer.from("7d2725b1a0527026", "hex")
const FAMILIES_VANILLA = ["resource_packs", "behavior_packs"]
const FAMILIES_ALL = ["resource_packs", "behavior_packs", "skin_packs"]

function write(dest, buf) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
}

function packInfo(name) {
  if (name === "vanilla_base") return { base: "vanilla", key: [0, 0, 0, 1] }
  const match = /^(.+?)_(\d+(?:\.\d+)+)$/.exec(name)
  if (!match) return { base: name, key: [0, 0, 0, 0] }
  const key = match[2].split(".").map(Number)
  while (key.length < 4) key.push(0)
  return { base: match[1], key }
}

function compareKeys(a, b) {
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function groupPacks(familyDir) {
  const groups = new Map()
  for (const name of listDirs(familyDir)) {
    const { base, key } = packInfo(name)
    if (!groups.has(base)) groups.set(base, [])
    groups.get(base).push({ name, key })
  }
  for (const list of groups.values()) {
    list.sort((a, b) => compareKeys(a.key, b.key))
  }
  return groups
}

function walk(dir, callback, rel = "") {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const next = rel ? path.join(rel, entry.name) : entry.name
    if (entry.isDirectory()) walk(full, callback, next)
    else if (entry.isFile()) callback(full, next)
  }
}

function listDirs(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
}

function planPack(packDir, plan) {
  walk(packDir, (src, rel) => {
    if (rel.startsWith("__brarchive" + path.sep)) return
    if (path.basename(rel) === "contents.json") return
    plan.set(rel, { type: "file", src })
  })

  walk(path.join(packDir, "__brarchive"), (src, rel) => {
    if (!rel.endsWith(".brarchive")) return
    const sub = rel.replace(/\.brarchive$/, "")
    const data = fs.readFileSync(src)
    if (data.length < 16 || !data.subarray(0, 8).equals(MAGIC)) return
    const count = data.readUInt32LE(8)
    const dataStart = 16 + count * 256
    let off = 16
    for (let i = 0; i < count; i++) {
      const nameLen = data[off]
      const name = data.toString("utf8", off + 1, off + 1 + nameLen)
      const entryOff = data.readUInt32LE(off + 1 + 247)
      const entryLen = data.readUInt32LE(off + 1 + 247 + 4)
      if (entryLen > 0) {
        plan.set(path.join(sub, name), { type: "br", file: src, start: dataStart + entryOff, len: entryLen })
      }
      off += 256
    }
  })
}

function writePlan(plan, outDir) {
  const cache = new Map()
  for (const [rel, entry] of plan) {
    let buf
    if (entry.type === "file") {
      buf = fs.readFileSync(entry.src)
    } else {
      let data = cache.get(entry.file)
      if (!data) {
        data = fs.readFileSync(entry.file)
        cache.set(entry.file, data)
      }
      buf = data.subarray(entry.start, entry.start + entry.len)
    }
    write(path.join(outDir, rel), buf)
  }
  return plan.size
}

function mergeGroup(familyDir, packs, outDir) {
  const plan = new Map()
  for (const pack of packs) {
    planPack(path.join(familyDir, pack.name), plan)
  }
  return writePlan(plan, outDir)
}

function detectVersion(content) {
  for (const family of FAMILIES_VANILLA) {
    const chain = groupPacks(path.join(content, "data", family)).get("vanilla")
    if (chain?.length) return chain[chain.length - 1].key.slice(0, 3).join(".")
  }
  return "current"
}

function parseArgs(argv) {
  const args = {}
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=([\s\S]*))?$/.exec(arg)
    if (match) args[match[1].toLowerCase()] = match[2] === undefined ? true : match[2]
  }
  return args
}

const INSTALLS = {
  preview: "C:/XboxGames/Minecraft Preview for Windows",
  release: "C:/XboxGames/Minecraft for Windows"
}

function resolveContent(dir) {
  if (!dir) return null
  if (fs.existsSync(path.join(dir, "data"))) return dir
  if (fs.existsSync(path.join(dir, "Content", "data"))) return path.join(dir, "Content")
  return null
}

function inferEdition(content) {
  const lower = content.toLowerCase()
  if (lower.includes("preview")) return "preview"
  if (lower.includes("minecraft for windows")) return "release"
  return "custom"
}

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  console.log(`Usage: node index.js [options]

  --rel=preview     use the Preview install; ERRORS if it isn't installed
  --rel=release     use the retail install; ERRORS if it isn't installed
  --rel=both        do BOTH editions (vanilla pack only)
  --rel=all         do BOTH editions and dump EVERY pack, not just vanilla
  (no --rel)        release first, falling back to preview

  --dir=<path>      explicit install dir (game root or its Content dir)
                    edition is still named from the path (preview/release)
  --out=<path>      output directory (default: ./output)
  --help`)
  process.exit(0)
}

const rel = typeof args.rel === "string" ? args.rel.toLowerCase() : null
if (rel && !["preview", "release", "both", "all"].includes(rel)) {
  console.error(`Unknown --rel=${rel}. Use preview | release | both | all.`)
  process.exit(1)
}

const allPacks = rel === "all"

const installed = []
for (const edition of ["release", "preview"]) {
  const content = resolveContent(INSTALLS[edition])
  if (content) installed.push({ edition, content })
}

function noInstall() {
  console.error("Could not find a Minecraft install. Use --dir=<path>.")
  process.exit(1)
}

let targets
if (args.dir) {
  const content = resolveContent(args.dir)
  if (!content) {
    console.error(`No Minecraft install found at: ${args.dir}\n(expected a "data" folder, or a "Content/data" folder inside it)`)
    process.exit(1)
  }
  targets = [{ edition: inferEdition(content), content }]
  if (rel === "all") console.log("note: --dir given -> only that install, but still dumping ALL packs")
  else if (rel) console.log(`note: --dir given -> ignoring --rel=${rel} (using only that install)`)
} else if (rel === "both" || rel === "all") {
  if (!installed.length) noInstall()
  if (installed.length === 1) console.log(`note: only the ${installed[0].edition} install is present`)
  targets = installed
} else if (rel === "preview" || rel === "release") {
  targets = installed.filter(t => t.edition === rel)
  if (!targets.length) {
    const other = installed[0]
    console.error(`No ${rel} install found at: ${INSTALLS[rel]}`)
    if (other) console.error(`(the ${other.edition} install IS present at: ${INSTALLS[other.edition]} -> use --rel=${other.edition})`)
    else console.error(`(no ${rel === "preview" ? "release" : "preview"} install either -> use --dir=<path>)`)
    process.exit(1)
  }
} else {
  if (!installed.length) noInstall()
  targets = [installed[0]]
}

const outBase = path.resolve((typeof args.out === "string" && args.out) || "output")

console.log(`mode: ${allPacks ? "all packs" : "vanilla"}  |  editions: ${targets.map(t => t.edition).join(", ")}`)

let grandTotal = 0
for (const { edition, content } of targets) {
  const version = detectVersion(content)
  console.log(`\n=== ${edition} (${version})\n  ${content}`)

  const name = `minecraft_${edition}_${version}${allPacks ? "_all" : ""}`  // <out>/<family>/<name>/

  for (const family of allPacks ? FAMILIES_ALL : FAMILIES_VANILLA) {
    const familyDir = path.join(content, "data", family)
    if (!fs.existsSync(familyDir)) continue
    const root = path.join(outBase, family, name)

    if (!allPacks) {
      const chain = groupPacks(familyDir).get("vanilla")
      if (!chain) continue
      const files = mergeGroup(familyDir, chain, root)
      grandTotal += files
      console.log(`    [${family}] ${chain.length} packs merged, ${files} files -> ${family}/${name}`)
    } else {
      const groups = [...groupPacks(familyDir).entries()].sort((a, b) => a[0].localeCompare(b[0]))
      let familyFiles = 0
      const parts = []
      for (const [base, packs] of groups) {
        familyFiles += mergeGroup(familyDir, packs, path.join(root, base))
        parts.push(packs.length > 1 ? `${base}(${packs.length})` : base)
      }
      grandTotal += familyFiles
      console.log(`    [${family}] ${groups.length} packs, ${familyFiles} files -> ${family}/${name}`)
      console.log(`      ${parts.join(", ")}`)
    }
  }
}

console.log(`\ntotal files written: ${grandTotal}`)
console.log("done.")
