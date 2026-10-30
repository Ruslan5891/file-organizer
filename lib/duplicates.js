import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { findAllFiles } from './scanner.js';

export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export class DuplicateFinder extends EventEmitter {
  async findDuplicates(directory) {
    const errors = [];
    const allFilePaths = await findAllFiles(directory, errors);
    const filePathsByHash = new Map();
    const fileSizeByHash = new Map();

    let processedFiles = 0;
    for (const filePath of allFilePaths) {
      try {
        const stats = await fsPromises.stat(filePath);
        const hash = await calculateHash(filePath);
        const filePaths = filePathsByHash.get(hash) ?? [];
        filePaths.push(filePath);
        filePathsByHash.set(hash, filePaths);
        fileSizeByHash.set(hash, stats.size);
      } catch (error) {
        errors.push({ path: filePath, error });
      }
      processedFiles += 1;
      this.emit('file-processed', { path: filePath, processedFiles, totalFiles: allFilePaths.length });
    }

    const duplicateGroups = [];
    for (const [hash, filePaths] of filePathsByHash) {
      if (filePaths.length > 1) {
        const fileSize = fileSizeByHash.get(hash);
        duplicateGroups.push({
          hash,
          filePaths,
          fileSize,
          wastedSpace: fileSize * (filePaths.length - 1),
        });
      }
    }
    const totalWastedSpace = duplicateGroups.reduce((sum, group) => sum + group.wastedSpace, 0);

    const result = { directory, duplicateGroups, totalWastedSpace, errors };
    this.emit('duplicates-found', result);
    return result;
  }
}
