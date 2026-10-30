import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { findAllFiles } from './scanner.js';

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: [],
};

const LARGE_FILE_SIZE = 10 * 1024 * 1024;

export function getCategory(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(categories)) {
    if (extensions.includes(extension)) {
      return category;
    }
  }
  return 'Other';
}

async function fileExists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function getAvailableTargetPath(targetDirectory, fileName) {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let targetPath = path.join(targetDirectory, fileName);
  let copyNumber = 1;

  while (await fileExists(targetPath)) {
    targetPath = path.join(targetDirectory, `${baseName}(${copyNumber})${extension}`);
    copyNumber += 1;
  }
  return targetPath;
}

async function copyFile(sourcePath, targetPath, fileSize) {
  if (fileSize < LARGE_FILE_SIZE) {
    await fsPromises.copyFile(sourcePath, targetPath);
  } else {
    await pipeline(
      fs.createReadStream(sourcePath),
      fs.createWriteStream(targetPath)
    );
  }
}

export class Organizer extends EventEmitter {
  async createCategoryFolders(targetDirectory) {
    for (const category of Object.keys(categories)) {
      await fsPromises.mkdir(path.join(targetDirectory, category), { recursive: true });
    }
    return Object.keys(categories);
  }

  async organize(sourceDirectory, targetDirectory) {
    const errors = [];
    const filePaths = await findAllFiles(sourceDirectory, errors);
    await this.createCategoryFolders(targetDirectory);

    const filesByCategory = Object.fromEntries(Object.keys(categories).map((category) => [category, 0]));
    let copiedFiles = 0;
    let copiedSize = 0;
    let processedFiles = 0;
    const totalFiles = filePaths.length;

    for (const sourcePath of filePaths) {
      const category = getCategory(sourcePath);
      this.emit('copy-start', { sourcePath, category, processedFiles, totalFiles });

      try {
        const stats = await fsPromises.stat(sourcePath);
        const targetPath = await getAvailableTargetPath(
          path.join(targetDirectory, category),
          path.basename(sourcePath)
        );
        await copyFile(sourcePath, targetPath, stats.size);

        filesByCategory[category] += 1;
        copiedFiles += 1;
        copiedSize += stats.size;
        processedFiles += 1;
        this.emit('copy-complete', { sourcePath, targetPath, category, size: stats.size, processedFiles, totalFiles });
      } catch (error) {
        processedFiles += 1;
        this.emit('copy-error', { sourcePath, category, error, processedFiles, totalFiles });
      }
    }

    return { sourceDirectory, targetDirectory, filesByCategory, copiedFiles, copiedSize, errors };
  }
}
