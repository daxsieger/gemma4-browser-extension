#!/usr/bin/env node

import { access, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";

const rootDir = process.cwd();
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const distTargets = ["dist/sidebar.html", "dist/background.js", "dist/content.js"];
const wizardStartedAt = Date.now();

const hasFlag = (flag) => process.argv.includes(flag);

const log = (message = "") => {
  process.stdout.write(`${message}\n`);
};

const resolveFromRoot = (relativePath) => path.join(rootDir, relativePath);

const fileExists = async (relativePath) => {
  try {
    await access(resolveFromRoot(relativePath));
    return true;
  } catch {
    return false;
  }
};

const getMtime = async (relativePath) => {
  try {
    const fileStats = await stat(resolveFromRoot(relativePath));
    return fileStats.mtimeMs;
  } catch {
    return 0;
  }
};

const prompt = async (message) => {
  const answer = await rl.question(message);
  const normalized = answer.trim().toLowerCase();

  if (normalized === "q" || normalized === "quit") {
    throw new Error("WIZARD_ABORTED");
  }

  return normalized;
};

const askYesNo = async (message) => {
  while (true) {
    const answer = await prompt(`${message} [y/n/q]: `);

    if (answer === "y" || answer === "yes") {
      return true;
    }

    if (answer === "n" || answer === "no") {
      return false;
    }

    log("Please answer with y, n, or q.");
  }
};

const waitForEnter = async (message) => {
  while (true) {
    const answer = await prompt(`${message} [Enter/q]: `);

    if (answer === "") {
      return;
    }

    log("Press Enter to continue, or q to quit.");
  }
};

const verifyDevBuild = async () => {
  const checks = await Promise.all(
    distTargets.map(async (relativePath) => ({
      relativePath,
      exists: await fileExists(relativePath),
      mtimeMs: await getMtime(relativePath),
    }))
  );

  const missingFiles = checks
    .filter((check) => !check.exists)
    .map((check) => check.relativePath);

  const rebuiltFiles = checks
    .filter((check) => check.mtimeMs >= wizardStartedAt)
    .map((check) => check.relativePath);

  return {
    ok: missingFiles.length === 0 && rebuiltFiles.length > 0,
    missingFiles,
    rebuiltFiles,
  };
};

const verifyNodeModules = async () => fileExists("node_modules");

const confirmManualStep = async (title, instructions, verifyMessage) => {
  log("");
  log(title);
  log(instructions);

  const confirmed = await askYesNo(verifyMessage);

  return {
    title,
    status: confirmed ? "passed" : "failed",
  };
};

const printHelp = () => {
  log("Voice test wizard");
  log("");
  log("Usage:");
  log("  pnpm run voice:wizard");
  log("  node scripts/voice-test-wizard.mjs");
  log("");
  log("What it does:");
  log("  - Reminds you to start pnpm dev in another terminal");
  log("  - Verifies that dist artifacts were rebuilt while the wizard was running");
  log("  - Walks you through loading the unpacked extension");
  log("  - Asks you to confirm the key manual voice test steps");
  log("");
  log("Commands during the wizard:");
  log("  - Press Enter to continue when requested");
  log("  - Type y or n for confirmations");
  log("  - Type q to quit");
};

const main = async () => {
  if (hasFlag("--help") || hasFlag("-h")) {
    printHelp();
    return;
  }

  log("Voice integration test wizard");
  log("");
  log("This wizard verifies what it can from the CLI and asks for confirmation on browser-only steps.");
  log("Keep a second terminal available for pnpm dev, because this wizard stays interactive.");

  const results = [];

  log("");
  log("Step 1: dependencies");
  const hasDependencies = await verifyNodeModules();
  if (!hasDependencies) {
    log("node_modules is missing.");
    log("Run `pnpm install` in another terminal, then come back here.");
    await waitForEnter("Press Enter when pnpm install has finished");
  }

  const dependenciesReady = await verifyNodeModules();
  results.push({
    title: "Dependencies installed",
    status: dependenciesReady ? "passed" : "failed",
  });

  log("");
  log("Step 2: dev watcher");
  log("In another terminal, run `pnpm dev` from the project root and wait for the first build to complete.");
  await waitForEnter("Press Enter once pnpm dev is running and the first rebuild has finished");

  const devBuildCheck = await verifyDevBuild();
  if (!devBuildCheck.ok) {
    log("The wizard could not verify a fresh dev build.");
    if (devBuildCheck.missingFiles.length > 0) {
      log(`Missing dist files: ${devBuildCheck.missingFiles.join(", ")}`);
    }
    if (devBuildCheck.rebuiltFiles.length === 0) {
      log("No dist file appears to have been rebuilt after the wizard started.");
    }
  } else {
    log(`Verified rebuilt files: ${devBuildCheck.rebuiltFiles.join(", ")}`);
  }
  results.push({
    title: "pnpm dev rebuild detected",
    status: devBuildCheck.ok ? "passed" : "failed",
  });

  results.push(
    await confirmManualStep(
      "Step 3: extensions page",
      "Open chrome://extensions or edge://extensions and make sure Developer mode is enabled.",
      "Did you open the extensions page and enable Developer mode?"
    )
  );

  results.push(
    await confirmManualStep(
      "Step 4: load unpacked",
      "Click Load unpacked and select the dist folder from this project.",
      "Did you load the extension from the dist folder?"
    )
  );

  results.push(
    await confirmManualStep(
      "Step 5: open the sidebar",
      "Open the extension side panel and focus the chat input.",
      "Did the side panel open correctly?"
    )
  );

  results.push(
    await confirmManualStep(
      "Step 6: microphone control",
      "Look for the microphone button next to the chat input.",
      "Do you see the microphone button?"
    )
  );

  results.push(
    await confirmManualStep(
      "Step 7: permission prompt",
      "Click the microphone button. If the browser asks for microphone permission, allow it for this extension.",
      "Did you click the microphone button and handle the permission prompt if it appeared?"
    )
  );

  results.push(
    await confirmManualStep(
      "Step 8: transcript check",
      "Speak a short sentence and verify that text is appended to the chat input.",
      "Did your speech appear in the input field?"
    )
  );

  results.push(
    await confirmManualStep(
      "Step 9: send flow",
      "Stop recording, then send the message to verify the normal chat flow still works.",
      "Were you able to stop recording and send the message?"
    )
  );

  const passed = results.filter((result) => result.status === "passed");
  const failed = results.filter((result) => result.status === "failed");

  log("");
  log("Summary");
  passed.forEach((result) => log(`[ok] ${result.title}`));
  failed.forEach((result) => log(`[fail] ${result.title}`));

  log("");
  if (failed.length === 0) {
    log("Voice test flow completed without reported failures.");
  } else {
    log("Voice test flow completed with failures.");
    log("Fix the failed steps, keep pnpm dev running, reload the extension, and rerun the wizard.");
  }

  log("");
  log("When you are done, stop the dev watcher in the other terminal with Ctrl+C.");
};

main()
  .catch((error) => {
    if (error instanceof Error && error.message === "WIZARD_ABORTED") {
      log("");
      log("Wizard stopped by user.");
      process.exitCode = 1;
      return;
    }

    log("");
    log(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    rl.close();
  });
