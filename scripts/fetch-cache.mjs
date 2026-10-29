#!/usr/bin/env node
// Download one or more specific caches from the OpenRS2 archive and rebuild
// caches/caches.json. Same on-disk layout as scripts/download-caches.js.
//
//   node scripts/fetch-cache.mjs osrs-241 rs2-295
//
// Matches archive entries whose generated directory name starts with any of the
// given prefixes (newest timestamp wins per match).
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const ARCHIVE_URL = "https://archive.openrs2.org/caches.json";
const CACHES_DIR = "caches";

function getCacheDir(cache) {
    const build = cache.builds[0].major;
    const date = cache.timestamp.split("T")[0];
    if (cache.game === "oldschool") {
        if (cache.environment === "beta") {
            return path.join(CACHES_DIR, `osrs-beta-${build}_${date}`);
        }
        return path.join(CACHES_DIR, `osrs-${build}_${date}`);
    }
    const langPostfix = cache.language !== "en" ? "-" + cache.language : "";
    return path.join(CACHES_DIR, `rs2-${build}${langPostfix}_${date}`);
}

function isValid(info) {
    if (info.valid_indexes !== info.indexes) {
        return false;
    }
    return info.valid_groups / info.groups >= 0.9;
}

async function fetchCacheFiles(cache) {
    const resp = await fetch(
        `https://archive.openrs2.org/caches/${cache.scope}/${cache.id}/disk.zip`,
    );
    if (!resp.ok) {
        throw new Error(`disk.zip ${resp.status} for ${cache.id}`);
    }
    return Buffer.from(await resp.arrayBuffer());
}

async function fetchXteas(cache) {
    const resp = await fetch(
        `https://archive.openrs2.org/caches/${cache.scope}/${cache.id}/keys.json`,
    );
    const keys = await resp.json();
    const xteas = {};
    for (const entry of keys) {
        xteas[entry.group.toString()] = entry.key;
    }
    return xteas;
}

function humanSize(bytes) {
    const units = ["B", "KiB", "MiB", "GiB"];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(1)} ${units[i]}`;
}

function createCacheList() {
    const caches = [];
    if (!fs.existsSync(CACHES_DIR)) {
        return caches;
    }

    for (const name of fs.readdirSync(CACHES_DIR)) {
        const dir = path.join(CACHES_DIR, name);
        const infoPath = path.join(dir, "info.json");
        if (!fs.statSync(dir).isDirectory() || !fs.existsSync(infoPath)) {
            continue;
        }
        const cacheInfo = JSON.parse(fs.readFileSync(infoPath, "utf8"));
        const revision = cacheInfo.builds[0].major;

        if (
            !isValid(cacheInfo) ||
            cacheInfo.language !== "en" ||
            (cacheInfo.game === "runescape" && (revision < 186 || revision > 740)) ||
            revision === 311
        ) {
            console.warn(`  skipping ${name} (not usable by the viewer)`);
            continue;
        }

        const mapsPath = path.join(dir, "maps");
        if (fs.existsSync(mapsPath)) {
            const mapNames = fs
                .readdirSync(mapsPath)
                .filter((n) => n.startsWith("m") || n.startsWith("l"));
            fs.writeFileSync(path.join(dir, "maps.json"), JSON.stringify(mapNames), "utf8");
        }

        caches.push({
            name,
            game: cacheInfo.game,
            environment: cacheInfo.environment,
            revision,
            timestamp: cacheInfo.timestamp,
            size: cacheInfo.size,
        });
        console.log(`  ok ${name} (${cacheInfo.game} rev ${revision})`);
    }

    fs.writeFileSync(path.join(CACHES_DIR, "caches.json"), JSON.stringify(caches), "utf8");
    console.log(`Wrote caches/caches.json with ${caches.length} cache(s)`);
    return caches;
}

async function main() {
    let prefixes = process.argv.slice(2);
    if (prefixes.length === 0) {
        prefixes = ["osrs-241", "rs2-295"];
    }

    console.log("Fetching archive index...");
    const archive = await (await fetch(ARCHIVE_URL)).json();

    const selected = [];
    for (const prefix of prefixes) {
        const matches = archive
            .filter(
                (c) =>
                    c.scope === "runescape" &&
                    c.language === "en" &&
                    c.builds.length > 0 &&
                    !!c.timestamp &&
                    isValid(c) &&
                    getCacheDir(c).startsWith(path.join(CACHES_DIR, prefix)),
            )
            .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

        if (matches.length === 0) {
            console.warn(`No cache matches "${prefix}"`);
            continue;
        }
        const cache = matches[0];
        const dir = getCacheDir(cache);
        if (fs.existsSync(path.join(dir, "info.json"))) {
            console.log(`Already have ${dir}`);
            selected.push(cache);
            continue;
        }

        console.log(`Downloading ${dir} (${humanSize(cache.size)})...`);
        fs.mkdirSync(dir, { recursive: true });
        const zip = new AdmZip(await fetchCacheFiles(cache), { readEntries: true });
        zip.extractEntryTo("cache/", dir + "/", false, true);

        fs.writeFileSync(
            path.join(dir, "keys.json"),
            JSON.stringify(await fetchXteas(cache)),
            "utf8",
        );
        fs.writeFileSync(path.join(dir, "info.json"), JSON.stringify(cache), "utf8");
        console.log(`  done ${dir}`);
        selected.push(cache);
    }

    createCacheList();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
