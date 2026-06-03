#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_MANIFEST = path.join(ROOT, "extension", "manifest.json");
const CHROME_ROOT = path.join(process.env.HOME || "", "Library/Application Support/Google/Chrome");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function chromePreferenceFiles() {
  if (!fs.existsSync(CHROME_ROOT)) {
    return [];
  }
  return fs.readdirSync(CHROME_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      path.join(CHROME_ROOT, entry.name, "Preferences"),
      path.join(CHROME_ROOT, entry.name, "Secure Preferences"),
    ])
    .filter((filePath) => fs.existsSync(filePath));
}

function isNswCourtsExtension(setting) {
  const manifest = setting.manifest || {};
  const text = [
    manifest.name,
    manifest.description,
    setting.path,
  ].filter(Boolean).join("\n");
  return /NSW Courts\+|NSW Courts|NSW-Courts-plus|Court Application Forms/i.test(text);
}

function loadedExtensions() {
  const found = [];
  for (const filePath of chromePreferenceFiles()) {
    let prefs;
    try {
      prefs = readJson(filePath);
    } catch {
      continue;
    }
    const settings = (prefs.extensions && prefs.extensions.settings) || {};
    for (const [id, setting] of Object.entries(settings)) {
      if (setting.location !== 4 || !isNswCourtsExtension(setting)) {
        continue;
      }
      const manifestPath = path.join(setting.path || "", "manifest.json");
      let diskVersion = null;
      if (fs.existsSync(manifestPath)) {
        diskVersion = readJson(manifestPath).version;
      }
      found.push({
        profile: path.basename(path.dirname(filePath)),
        preferences: path.basename(filePath),
        id,
        path: setting.path,
        storedVersion: setting.service_worker_registration_info && setting.service_worker_registration_info.version,
        diskVersion,
        enabled: !Array.isArray(setting.disable_reasons) || setting.disable_reasons.length === 0,
      });
    }
  }
  return found;
}

const sourceVersion = readJson(SOURCE_MANIFEST).version;
const matches = loadedExtensions();

if (matches.length === 0) {
  console.error("No loaded unpacked NSW Courts+ Chrome extension found.");
  process.exit(1);
}

let failed = false;
for (const match of matches) {
  const ok = match.diskVersion === sourceVersion;
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} ${match.profile}/${match.id} disk=${match.diskVersion || "missing"} source=${sourceVersion} stored_worker=${match.storedVersion || "unknown"} path=${match.path}`);
  if (!ok) {
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
