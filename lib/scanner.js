import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;
const LARGEST_FILES_COUNT = 3;

export async function findAllFiles(directory, skippedDirectories = []) {
  const filePaths = [];
  await collectFiles(directory, filePaths, skippedDirectories, true);
  return filePaths;
}

async function collectFiles(directory, filePaths, skippedDirectories, isStartDirectory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isStartDirectory) {
      throw error;
    }
    skippedDirectories.push({ path: directory, error });
    return;
  }

  for (const entry of entries) {
    const entryPath = `${directory}${path.sep}${entry.name}`;
    if (entry.isDirectory()) {
      await collectFiles(entryPath, filePaths, skippedDirectories, false);
    } else if (entry.isFile()) {
      filePaths.push(entryPath);
    }
  }
}

export class Scanner extends EventEmitter {
  async scan(directory) {
    this.emit('scan-start', { directory });

    const errors = [];
    const files = await findAllFiles(directory, errors);
    const statistics = {
      directory,
      totalFiles: 0,
      totalSize: 0,
      byExtension: new Map(),
      byAge: { lastSevenDays: 0, lastThirtyDays: 0, olderThanNinetyDays: 0 },
      largestFiles: [],
      oldestFile: null,
      errors,
    };

    let processedFiles = 0;
    for (const file of files) {
      try {
        const stats = await fs.stat(file);
        const fileData = {
          path: file,
          size: stats.size,
          modifiedAt: stats.mtime,
          extension: path.extname(file).toLowerCase(),
        };
        addFileToStatistics(statistics, fileData);
        processedFiles += 1;
        this.emit('file-found', { ...fileData, processedFiles, totalFiles: files.length });
      } catch (error) {
        errors.push({ path: file, error });
      }
    }

    this.emit('scan-complete', statistics);
    return statistics;
  }
}

function addFileToStatistics(statistics, fileData) {
  statistics.totalFiles += 1;
  statistics.totalSize += fileData.size;

  const extensionStatistics = statistics.byExtension.get(fileData.extension) ?? { count: 0, totalSize: 0 };
  extensionStatistics.count += 1;
  extensionStatistics.totalSize += fileData.size;
  statistics.byExtension.set(fileData.extension, extensionStatistics);

  const fileAge = Date.now() - fileData.modifiedAt.getTime();
  const daysOld = fileAge / MILLISECONDS_IN_DAY;
  if (daysOld <= 7) {
    statistics.byAge.lastSevenDays += 1;
  }
  if (daysOld <= 30) {
    statistics.byAge.lastThirtyDays += 1;
  }
  if (daysOld > 90) {
    statistics.byAge.olderThanNinetyDays += 1;
  }

  if (!statistics.oldestFile || fileData.modifiedAt < statistics.oldestFile.modifiedAt) {
    statistics.oldestFile = { path: fileData.path, modifiedAt: fileData.modifiedAt, daysOld };
  }

  const { largestFiles } = statistics;
  if (largestFiles.length < LARGEST_FILES_COUNT || fileData.size > largestFiles[largestFiles.length - 1].size) {
    largestFiles.push({ path: fileData.path, size: fileData.size });
    largestFiles.sort((firstFile, secondFile) => secondFile.size - firstFile.size);
    largestFiles.length = Math.min(largestFiles.length, LARGEST_FILES_COUNT);
  }
}
