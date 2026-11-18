#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";

const originDefault = "pelppal-web.vercel.app";
const rl = readline.createInterface({ input, output });
const activeForwards = new Set();
let adbExecutable;
let deviceSerial;
const ask = (question) => rl.question(question);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  }
  return result.stdout.trim();
}

function findAdb() {
  for (const candidate of [
    process.env.ADB,
    "adb",
    path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk", "platform-tools", "adb.exe"),
  ].filter(Boolean)) {
    const result = spawnSync(candidate, ["version"], { encoding: "utf8", windowsHide: true });
    if (result.status === 0) return candidate;
  }
  throw new Error("ADB was not found. Install Android platform-tools or set ADB to adb.exe.");
}

function adb(adbPath, serial, ...args) {
  return run(adbPath, ["-s", serial, ...args]);
}

async function chooseDevice(adbPath) {
  const rows = run(adbPath, ["devices", "-l"]).split(/\r?\n/).slice(1).filter(Boolean);
  const devices = rows.map((line) => {
    const [serial, state, ...details] = line.trim().split(/\s+/);
    return { serial, state, details: details.join(" ") };
  });
  const ready = devices.filter((device) => device.state === "device");
  if (!ready.length) {
    const unauthorized = devices.some((device) => device.state === "unauthorized");
    throw new Error(unauthorized
      ? "The phone is unauthorized. Unlock it and approve the USB debugging prompt, then rerun."
      : "No authorized ADB device found. Connect the phone with USB debugging enabled, then rerun.");
  }
  if (ready.length === 1) return ready[0].serial;
  console.log("Connected devices:");
  ready.forEach((device, index) => console.log(`  ${index + 1}. ${device.serial} ${device.details}`));
  const choice = Number(await ask("Choose device number: "));
  if (!Number.isInteger(choice) || choice < 1 || choice > ready.length) throw new Error("Invalid device selection.");
  return ready[choice - 1].serial;
}

function installedBrowsers(adbPath, serial) {
  const packages = adb(adbPath, serial, "shell", "pm", "list", "packages").split(/\r?\n/)
    .map((line) => line.replace(/^package:/, "").trim())
    .filter((name) => /chrome|browser|firefox|brave|opera|edge|vivaldi|duckduckgo/i.test(name));
  return [...new Set(packages)].sort();
}

function debuggingSockets(adbPath, serial) {
  const output = adb(adbPath, serial, "shell", "cat", "/proc/net/unix");
  return [...new Set(output.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/).at(-1) || "")
    .map((name) => name.replace(/^@/, ""))
    .filter((name) => /devtools_remote/i.test(name)))].sort();
}

async function browserTargets(adbPath, serial, sockets) {
  const targets = [];
  for (const socket of sockets) {
    let port;
    try {
      port = Number(adb(adbPath, serial, "forward", "tcp:0", `localabstract:${socket}`));
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const list = await response.json();
      const pages = list.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (pages.length) {
        activeForwards.add(port);
        targets.push(...pages.map((item) => ({ ...item, socket, debugPort: port })));
      }
    } catch (error) {
      console.log(`  ${socket}: not reachable (${error.message})`);
    } finally {
      if (port && !activeForwards.has(port)) {
        spawnSync(adbPath, ["-s", serial, "forward", "--remove", `tcp:${port}`], { windowsHide: true });
      }
    }
  }
  return targets;
}

async function cdpEvaluate(webSocketUrl, expression) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DevTools connection timed out.")), 8000);
    socket.onopen = () => { clearTimeout(timer); resolve(); };
    socket.onerror = () => { clearTimeout(timer); reject(new Error("Browser blocked the DevTools connection.")); };
  });
  try {
    const id = 1;
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Page evaluation timed out.")), 30_000);
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id === id) {
          clearTimeout(timer);
          resolve(message);
        }
      };
    });
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true, timeout: 25_000 },
    }));
    const message = await reply;
    if (message.error) throw new Error(message.error.message);
    if (message.result?.exceptionDetails) throw new Error(message.result.exceptionDetails.text || "Page evaluation failed.");
    return message.result?.result?.value;
  } finally {
    socket.close();
  }
}

function recoveryExpression(ids) {
  return `(${async function exportEvidence(wanted) {
    const databases = await indexedDB.databases();
    if (!databases?.some((database) => database.name === "pelp-pal-web")) return { error: "No existing PELP database in this browser profile." };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("pelp-pal-web");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database is blocked by another tab."));
    });
    const names = ["evidence", "evidenceBlobs"];
    if (!names.every((name) => db.objectStoreNames.contains(name))) return { error: "PELP evidence stores are not present in this browser profile." };
    const tx = db.transaction(names, "readonly");
    const read = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const blobs = tx.objectStore("evidenceBlobs");
    const evidence = tx.objectStore("evidence");
    const selected = await Promise.all(wanted.map((id) => read(blobs.get(id))));
    const metadata = await Promise.all(wanted.map((id) => read(evidence.get(id))));
    const entries = await Promise.all(selected.filter(Boolean).map(async (row) => {
      const bytes = new Uint8Array(await row.blob.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      const record = metadata.find((item) => item?.id === row.id);
      return {
        id: row.id,
        inspectionId: row.inspectionId,
        capturedAt: record?.capturedAt || record?.createdAt || null,
        mimeType: row.mimeType || row.blob.type || "image/jpeg",
        base64: btoa(binary),
      };
    }));
    return { databaseVersion: db.version, entries };
  }.toString()})(${JSON.stringify(ids)})`;
}

function safeExtension(mimeType) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" })[mimeType] || "img";
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22 || typeof WebSocket === "undefined") {
    throw new Error("Node.js 22 or newer is required for the built-in WebSocket client.");
  }
  const adbPath = findAdb();
  adbExecutable = adbPath;
  console.log("PELP Pal evidence recovery (read-only on the phone)\n");
  const serial = await chooseDevice(adbPath);
  deviceSerial = serial;
  const browsers = installedBrowsers(adbPath, serial);
  console.log(`\nDevice: ${serial}`);
  console.log(`Installed browser packages: ${browsers.length ? browsers.join(", ") : "none detected"}`);

  const sockets = debuggingSockets(adbPath, serial);
  console.log(`Remote-debugging sockets: ${sockets.length ? sockets.join(", ") : "none"}`);
  if (!sockets.length) {
    console.log("Enable browser remote debugging where supported, open PELP Pal in each browser, and rerun.");
    return;
  }

  const pages = await browserTargets(adbPath, serial, sockets);
  const pelpHost = (await ask(`PELP host [${originDefault}]: `)).trim() || originDefault;
  const pelpPages = pages.filter((page) => {
    try { return new URL(page.url).hostname.toLowerCase() === pelpHost.toLowerCase(); }
    catch { return false; }
  });
  console.log("\nOpen browser pages:");
  for (const page of pages) console.log(`  [${page.socket}] ${page.url || page.title || "(untitled)"}`);
  if (!pelpPages.length) {
    console.log(`\nNo open page matched ${pelpHost}. Open PELP Pal in the browsers to inspect, then rerun.`);
    return;
  }

  const ids = [...new Set((await ask("Evidence photo IDs to recover (comma/space separated): "))
    .split(/[\s,;]+/).map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) throw new Error("Enter at least one evidence ID; the script will not export all photos by default.");

  const outputDir = path.join(os.homedir(), "Downloads", `PELP-evidence-recovery-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await mkdir(outputDir, { recursive: true });
  const recovered = new Set();
  const reports = [];
  for (const page of pelpPages) {
    const pending = ids.filter((id) => !recovered.has(id));
    if (!pending.length) break;
    try {
      const browserSocket = new URL(page.webSocketDebuggerUrl);
      browserSocket.hostname = "127.0.0.1";
      browserSocket.port = String(page.debugPort);
      const result = await cdpEvaluate(browserSocket.href, recoveryExpression(pending));
      if (result?.error) {
        reports.push(`${page.socket}: ${result.error}`);
        continue;
      }
      for (const entry of result?.entries || []) {
        if (recovered.has(entry.id)) continue;
        const filename = `${entry.id}.${safeExtension(entry.mimeType)}`;
        const filePath = path.join(outputDir, filename);
        const bytes = Buffer.from(entry.base64, "base64");
        await writeFile(filePath, bytes, { flag: "wx" });
        const checksum = createHash("sha256").update(bytes).digest("hex");
        console.log(`  Saved ${entry.id} (${bytes.length} bytes, SHA-256 ${checksum}) from ${page.socket}`);
        recovered.add(entry.id);
      }
    } catch (error) {
      reports.push(`${page.socket}: ${error.message}`);
    }
  }

  const missing = ids.filter((id) => !recovered.has(id));
  console.log(`\nRecovered ${recovered.size}/${ids.length} photos to ${outputDir}`);
  if (missing.length) console.log(`Not found in inspected browser profiles: ${missing.join(", ")}`);
  for (const report of reports) console.log(`Note: ${report}`);
  if (!recovered.size) console.log("A PELP tab must be open and its browser remote-debugging interface must permit page inspection.");
}

main().catch((error) => {
  console.error(`\nRecovery stopped: ${error.message}`);
  process.exitCode = 1;
}).finally(() => {
  if (adbExecutable && deviceSerial) {
    for (const port of activeForwards) {
      spawnSync(adbExecutable, ["-s", deviceSerial, "forward", "--remove", `tcp:${port}`], { windowsHide: true });
    }
  }
  rl.close();
});
