import path from "node:path";
import dotenv from "dotenv";
import { initDatabase } from "./db.js";
import { MediaRepository } from "./mediaRepository.js";
import { importSnapchatMemories } from "./importers/snapchatImporter.js";

dotenv.config();

const libraryRoot = process.env.LIBRARY_ROOT || "D:/Photos";
const dbPath = process.env.DATABASE_PATH || path.join(libraryRoot, "library.sqlite");

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || args.includes("--help") || args.includes("-h")) {
    console.log(`
Personal Photo Cloud CLI

Usage:
  npm run import:snapchat <path-to-export> [--dry-run]
  tsx src/cli.ts import:snapchat <path-to-export> [--dry-run]

Commands:
  import:snapchat <path>   Import Snapchat memories from an export directory or .zip archive
`);
    process.exit(0);
  }

  if (command === "import:snapchat") {
    const targetPath = args[1];
    if (!targetPath) {
      console.error("Error: Please provide path to Snapchat export directory or .zip file.");
      console.error("Example: npm run import:snapchat C:/Users/Me/Downloads/mydata");
      process.exit(1);
    }

    const isDryRun = args.includes("--dry-run");

    console.log(`\n========================================`);
    console.log(`  Snapchat Memories Importer`);
    console.log(`========================================`);
    console.log(`Export path : ${targetPath}`);
    console.log(`Library root: ${libraryRoot}`);
    console.log(`Database    : ${dbPath}`);
    if (isDryRun) console.log(`Mode        : DRY RUN (no files will be written)`);
    console.log(`----------------------------------------\n`);

    const db = initDatabase(dbPath);
    const mediaRepo = new MediaRepository(db);

    console.log(`Scanning export package and parsing memories...`);
    const startTime = Date.now();

    try {
      const result = importSnapchatMemories(targetPath, libraryRoot, mediaRepo, {
        dryRun: isDryRun,
      });

      const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);

      console.log(`\n========================================`);
      console.log(`  Import Complete (${durationSec}s)`);
      console.log(`========================================`);
      console.log(`Total media files found : ${result.totalFilesFound}`);
      console.log(`Memories metadata parsed: ${result.recordsParsed}`);
      console.log(`Successfully imported   : ${result.importedCount}`);
      console.log(`Skipped duplicates      : ${result.skippedDuplicates}`);

      if (result.errors.length > 0) {
        console.log(`\nErrors encountered (${result.errors.length}):`);
        for (const err of result.errors) {
          console.log(`  - ${err.file || "General"}: ${err.error}`);
        }
      }
      console.log(`\nYour memories are now available in the "Snapchat Memories" vault!\n`);
    } catch (err: any) {
      console.error(`\nImport failed: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
