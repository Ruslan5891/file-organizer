import { EventEmitter } from 'events';
import fs from 'fs/promises';
import { findAllFiles } from './scanner.js';

export class Cleanup extends EventEmitter {
  async findOldFiles(directory, threshold) {
    const errors = [];
    const filePaths = await findAllFiles(directory, errors);
    const oldFiles = [];

    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        const fileAge = Date.now() - stats.mtime.getTime();
        const daysOld = fileAge / (1000 * 60 * 60 * 24);

        if (daysOld > threshold) {
          const oldFile = { path: filePath, size: stats.size, modifiedAt: stats.mtime, daysOld };
          oldFiles.push(oldFile);
          this.emit('file-found', oldFile);
        }
      } catch (error) {
        errors.push({ path: filePath, error });
      }
    }

    const totalSize = oldFiles.reduce((sum, oldFile) => sum + oldFile.size, 0);
    return { oldFiles, totalSize, errors };
  }

  async deleteFiles(oldFiles, { dryRun = false } = {}) {
    const errors = [];
    let deletedFiles = 0;
    let freedSpace = 0;
    let processedFiles = 0;

    if (dryRun) {
      const result = { dryRun, deletedFiles, freedSpace, errors };
      this.emit('cleanup-complete', result);
      return result;
    }

    for (const oldFile of oldFiles) {
      try {
        await fs.unlink(oldFile.path);
        deletedFiles += 1;
        freedSpace += oldFile.size;
        processedFiles += 1;
        this.emit('file-deleted', { ...oldFile, processedFiles, totalFiles: oldFiles.length });
      } catch (error) {
        processedFiles += 1;
        errors.push({ path: oldFile.path, error });
      }
    }

    const result = { dryRun, deletedFiles, freedSpace, errors };
    this.emit('cleanup-complete', result);
    return result;
  }
}
