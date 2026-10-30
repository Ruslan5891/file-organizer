import path from 'path';
import { Scanner } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';

const SEPARATOR = '━'.repeat(32);
const TOP_FILE_TYPES_COUNT = 5;
const DRY_RUN_PREVIEW_COUNT = 3;
const HASH_PREVIEW_LENGTH = 12;

let isProgressLineActive = false;

function formatSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
}

function drawProgressBar(current, total, width = 20) {
  const percentage = current / total;
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

function showProgress(label, current, total, suffix = '') {
  process.stdout.write(`\r${label} ${drawProgressBar(current, total)}${suffix}`);
  isProgressLineActive = true;
}

function finishProgressLine() {
  if (isProgressLineActive) {
    process.stdout.write('\n');
    isProgressLineActive = false;
  }
}

function printFileError(error, filePath) {
  if (error.code === 'ENOENT') {
    console.error(`❌ Error: File not found: ${filePath}`);
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error(`❌ Error: Permission denied: ${filePath}`);
  } else {
    console.error(`❌ Unexpected error: ${error.message}`);
  }
}

function printErrors(errors) {
  finishProgressLine();
  for (const { path: filePath, error } of errors) {
    printFileError(error, filePath);
  }
}

function exitWithArgumentError(message) {
  console.error(`❌ Error: ${message}`);
  process.exit(1);
}

const COMMAND_FORMATS = {
  scan: 'node file-organizer.js scan /path/to/directory',
  duplicates: 'node file-organizer.js duplicates /path/to/directory',
  organize: 'node file-organizer.js organize /source/directory --output /target/directory',
  cleanup: 'node file-organizer.js cleanup /path/to/directory --older-than 90 [--confirm]',
};

const COMMAND_OPTIONS = {
  scan: [],
  duplicates: [],
  organize: ['--output'],
  cleanup: ['--older-than', '--confirm'],
};

const OPTIONS_WITH_VALUE = ['--output', '--older-than'];

function isMissingValue(value) {
  return value === undefined || value === '' || value.startsWith('--');
}

function parseArguments(args) {
  const [command, directory, ...restArguments] = args;
  const options = { output: null, olderThan: null, confirm: false };
  const usedOptions = [];
  const optionsWithoutValue = [];
  const unexpectedArguments = [];

  for (let index = 0; index < restArguments.length; index++) {
    const argument = restArguments[index];

    if (OPTIONS_WITH_VALUE.includes(argument)) {
      usedOptions.push(argument);
      const value = restArguments[index + 1];
      if (isMissingValue(value)) {
        optionsWithoutValue.push(argument);
        if (value === '') {
          index += 1;
        }
        continue;
      }
      if (argument === '--output') {
        options.output = value;
      } else {
        options.olderThan = value;
      }
      index += 1;
    } else if (argument === '--confirm') {
      usedOptions.push(argument);
      options.confirm = true;
    } else {
      unexpectedArguments.push(argument);
    }
  }

  return { command, directory, options, usedOptions, optionsWithoutValue, unexpectedArguments };
}

function validateArguments({ command, directory, options, usedOptions, optionsWithoutValue, unexpectedArguments }) {
  const availableCommands = Object.keys(COMMAND_FORMATS).join(', ');

  if (command === undefined) {
    exitWithArgumentError(`No command provided. Available commands: ${availableCommands}`);
  }
  if (!Object.hasOwn(COMMAND_FORMATS, command)) {
    exitWithArgumentError(`Unknown command: ${command}. Available commands: ${availableCommands}`);
  }

  const commandFormat = COMMAND_FORMATS[command];
  if (directory === undefined || directory === '') {
    exitWithArgumentError(`Directory path is required: ${commandFormat}`);
  }
  if (directory.startsWith('--')) {
    exitWithArgumentError(`Directory path must go right after the command: ${commandFormat}`);
  }

  for (const argument of unexpectedArguments) {
    if (argument.startsWith('-')) {
      exitWithArgumentError(`Unknown option: ${argument}. Usage: ${commandFormat}`);
    }
    exitWithArgumentError(`Unexpected argument: ${argument}. Usage: ${commandFormat}`);
  }

  for (const option of usedOptions) {
    if (!COMMAND_OPTIONS[command].includes(option)) {
      exitWithArgumentError(`Option ${option} is not supported by "${command}". Usage: ${commandFormat}`);
    }
    if (option === '--output' && optionsWithoutValue.includes(option)) {
      exitWithArgumentError('Option --output requires a value: --output /target/directory');
    }
    if (option === '--older-than' && optionsWithoutValue.includes(option)) {
      exitWithArgumentError('Option --older-than requires a value: --older-than 90');
    }
  }

  if (command === 'organize' && options.output === null) {
    exitWithArgumentError(`Target directory is required: ${commandFormat}`);
  }
  if (command === 'cleanup' && options.olderThan === null) {
    exitWithArgumentError(`Number of days is required: ${commandFormat}`);
  }
  if (command === 'cleanup') {
    const olderThanDays = Number(options.olderThan);
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0) {
      exitWithArgumentError(`--older-than must be a non-negative number of days, got: ${options.olderThan}`);
    }
  }
}

async function runScan(directory) {
  const scanner = new Scanner();

  scanner.on('scan-start', (data) => {
    console.log(`📂 Scanning: ${data.directory}`);
  });

  scanner.on('file-found', (data) => {
    showProgress('Processing...', data.processedFiles, data.totalFiles, ' files');
  });

  scanner.on('scan-complete', (statistics) => {
    printErrors(statistics.errors);
    printScanResults(statistics);
  });

  await scanner.scan(directory);
}

function printScanResults(statistics) {
  console.log('\n📊 Scan Results:');
  console.log(SEPARATOR);
  console.log(`Total files: ${statistics.totalFiles}`);
  console.log(`Total size: ${formatSize(statistics.totalSize)}`);

  if (statistics.totalFiles === 0) {
    return;
  }

  const fileTypes = [...statistics.byExtension]
    .filter(([extension]) => extension !== '')
    .sort(([, firstType], [, secondType]) => secondType.totalSize - firstType.totalSize);
  const fileTypesToShow = fileTypes.slice(0, TOP_FILE_TYPES_COUNT);
  const otherFileTypes = [
    ...fileTypes.slice(TOP_FILE_TYPES_COUNT),
    ...[...statistics.byExtension].filter(([extension]) => extension === ''),
  ];
  if (otherFileTypes.length > 0) {
    fileTypesToShow.push([
      '(other)',
      {
        count: otherFileTypes.reduce((sum, [, fileType]) => sum + fileType.count, 0),
        totalSize: otherFileTypes.reduce((sum, [, fileType]) => sum + fileType.totalSize, 0),
      },
    ]);
  }

  const extensionWidth = Math.max(...fileTypesToShow.map(([extension]) => extension.length)) + 1;
  const countWidth = Math.max(...fileTypesToShow.map(([, fileType]) => String(fileType.count).length));
  const sizeWidth = Math.max(...fileTypesToShow.map(([, fileType]) => formatSize(fileType.totalSize).length));
  console.log('\nBy File Type:');
  for (const [extension, fileType] of fileTypesToShow) {
    const countText = String(fileType.count).padStart(countWidth);
    const sizeText = formatSize(fileType.totalSize).padStart(sizeWidth);
    console.log(`  ${extension.padEnd(extensionWidth)}${countText} files   ${sizeText}`);
  }

  const { byAge } = statistics;
  const ageCountWidth = Math.max(
    ...[byAge.lastSevenDays, byAge.lastThirtyDays, byAge.olderThanNinetyDays].map((count) => String(count).length)
  );
  console.log('\nFile Age:');
  console.log(`  Last 7 days:    ${String(byAge.lastSevenDays).padStart(ageCountWidth)} files`);
  console.log(`  Last 30 days:   ${String(byAge.lastThirtyDays).padStart(ageCountWidth)} files`);
  console.log(`  Older than 90:  ${String(byAge.olderThanNinetyDays).padStart(ageCountWidth)} files`);

  const largestFileNames = statistics.largestFiles.map((file) => path.basename(file.path));
  const nameWidth = Math.max(...largestFileNames.map((fileName) => fileName.length)) + 3;
  const largestSizeWidth = Math.max(...statistics.largestFiles.map((file) => formatSize(file.size).length));
  console.log('\nLargest files:');
  statistics.largestFiles.forEach((file, index) => {
    console.log(`  ${index + 1}. ${largestFileNames[index].padEnd(nameWidth)}${formatSize(file.size).padStart(largestSizeWidth)}`);
  });

  const { oldestFile } = statistics;
  console.log(`\nOldest file: ${path.basename(oldestFile.path)} (modified ${Math.floor(oldestFile.daysOld)} days ago)`);
}

async function runDuplicates(directory) {
  const duplicateFinder = new DuplicateFinder();

  console.log(`🔍 Searching for duplicates in: ${directory}`);

  duplicateFinder.on('file-processed', (data) => {
    showProgress('Calculating hashes...', data.processedFiles, data.totalFiles, ' files');
  });

  duplicateFinder.on('duplicates-found', (result) => {
    printErrors(result.errors);
    printDuplicates(result);
  });

  await duplicateFinder.findDuplicates(directory);
}

function printDuplicates(result) {
  const { directory, duplicateGroups, totalWastedSpace } = result;
  const directoryName = path.basename(directory);

  console.log(`\nFound ${duplicateGroups.length} duplicate groups (${formatSize(totalWastedSpace)} wasted):`);

  duplicateGroups.forEach((group, index) => {
    console.log(`\n${SEPARATOR}`);
    console.log(`Group ${index + 1} (${group.filePaths.length} copies, ${formatSize(group.fileSize)} each):`);
    console.log(`  SHA-256: ${group.hash.slice(0, HASH_PREVIEW_LENGTH)}...\n`);
    for (const filePath of group.filePaths) {
      console.log(`  📄 ${path.join(directoryName, path.relative(directory, filePath))}`);
    }
    console.log(`\n  Wasted space: ${formatSize(group.wastedSpace)}`);
  });

  console.log(`\n${SEPARATOR}`);
  console.log(`💾 Total wasted space: ${formatSize(totalWastedSpace)}`);
}

async function runOrganize(sourceDirectory, targetDirectory) {
  const organizer = new Organizer();
  const copyErrors = [];

  console.log(`📦 Organizing: ${sourceDirectory}`);
  console.log(`Target: ${targetDirectory}`);

  console.log('\nCreating folders...');
  const createdFolders = await organizer.createCategoryFolders(targetDirectory);
  for (const folder of createdFolders) {
    console.log(`  ✓ ${folder}/`);
  }
  console.log('');

  organizer.on('copy-complete', (data) => {
    showProgress('Copying files...', data.processedFiles, data.totalFiles);
  });

  organizer.on('copy-error', (data) => {
    copyErrors.push({ path: data.sourcePath, error: data.error });
    showProgress('Copying files...', data.processedFiles, data.totalFiles);
  });

  const summary = await organizer.organize(sourceDirectory, targetDirectory);

  printErrors([...summary.errors, ...copyErrors]);

  const targetName = path.basename(targetDirectory);
  const categoryWidth = Math.max(...Object.keys(summary.filesByCategory).map((category) => category.length)) + 2;
  const countWidth = Math.max(...Object.values(summary.filesByCategory).map((count) => String(count).length));

  console.log('\n✅ Organization complete!');
  console.log('\nSummary:');
  for (const [category, count] of Object.entries(summary.filesByCategory)) {
    console.log(`  ${`${category}:`.padEnd(categoryWidth)}${String(count).padStart(countWidth)} files → ${targetName}/${category}/`);
  }
  console.log(`\nTotal copied: ${summary.copiedFiles} files (${formatSize(summary.copiedSize)})`);
}

async function runCleanup(directory, olderThanDays, confirm) {
  const cleanup = new Cleanup();

  console.log(`🧹 Cleanup: ${directory}`);
  console.log(`Looking for files older than ${olderThanDays} days...`);

  const { oldFiles, totalSize, errors } = await cleanup.findOldFiles(directory, olderThanDays);
  printErrors(errors);

  console.log(`\nFound ${oldFiles.length} files to delete:\n`);
  console.log(SEPARATOR);
  for (const oldFile of oldFiles.slice(0, DRY_RUN_PREVIEW_COUNT)) {
    console.log(`\n${path.basename(oldFile.path)}`);
    console.log(`  Size: ${formatSize(oldFile.size)}`);
    console.log(`  Modified: ${Math.floor(oldFile.daysOld)} days ago (${oldFile.modifiedAt.toISOString().slice(0, 10)})`);
  }
  if (oldFiles.length > DRY_RUN_PREVIEW_COUNT) {
    console.log(`\n... (${oldFiles.length - DRY_RUN_PREVIEW_COUNT} more files)`);
  }
  console.log(SEPARATOR);
  console.log(`\nTotal: ${oldFiles.length} files (${formatSize(totalSize)})`);

  cleanup.on('file-deleted', (data) => {
    showProgress('Deleting...', data.processedFiles, data.totalFiles);
  });

  cleanup.on('cleanup-complete', (result) => {
    if (result.dryRun) {
      console.log('\n⚠️  DRY RUN MODE: No files were deleted.');
      console.log('To actually delete these files, run with --confirm flag.');
      return;
    }
    printErrors(result.errors);
    console.log('\n✅ Cleanup complete!');
    console.log(`Deleted: ${result.deletedFiles} files (${formatSize(result.freedSpace)} freed)`);
  });

  if (confirm && oldFiles.length > 0) {
    console.log(`\n⚠️  DELETING ${oldFiles.length} files (${formatSize(totalSize)}). This action cannot be undone!\n`);
  }

  await cleanup.deleteFiles(oldFiles, { dryRun: !confirm });
}

async function main() {
  const parsedArguments = parseArguments(process.argv.slice(2));
  validateArguments(parsedArguments);

  const { command, directory, options } = parsedArguments;
  const olderThanDays = Number(options.olderThan);
  const targetDirectory = path.resolve(directory);

  try {
    if (command === 'scan') {
      await runScan(targetDirectory);
    } else if (command === 'duplicates') {
      await runDuplicates(targetDirectory);
    } else if (command === 'organize') {
      await runOrganize(targetDirectory, path.resolve(options.output));
    } else if (command === 'cleanup') {
      await runCleanup(targetDirectory, olderThanDays, options.confirm);
    }
  } catch (error) {
    finishProgressLine();
    if (error.code === 'ENOENT') {
      console.error(`❌ Error: Directory not found: ${error.path ?? targetDirectory}`);
    } else if (error.code === 'EACCES' || error.code === 'EPERM') {
      console.error(`❌ Error: Permission denied: ${error.path ?? targetDirectory}`);
    } else {
      console.error(`❌ Unexpected error: ${error.message}`);
    }
    process.exit(1);
  }
}

main();
