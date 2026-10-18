import { atomicWriteJson } from '../filesystem/atomic-write.js';
import { readFileRaceSafe } from '../filesystem/race-safe-read.js';
import { unlinkWithRetry } from '../filesystem/transient-retry.js';
import { withRecoverableFileLock } from './recoverable-file-lock.js';

const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;

export interface FileTransitionContext<TJournal> {
  commit(
    journal: TJournal,
    complete: (journal: TJournal) => Promise<void>,
    afterJournalWritten?: (journal: TJournal) => void | Promise<void>,
  ): Promise<void>;
}

/**
 * Shared intent-journal protocol for state projections.
 *
 * Domain stores retain their own state validation and completion order. This
 * coordinator owns the shared lock, durable intent, replay and cleanup sequence
 * so a new aggregate cannot silently invent another recovery model.
 */
export class RecoverableFileTransition<TJournal> {
  constructor(
    private readonly lockPath: string,
    private readonly journalPath: string,
  ) {}

  async run<T>(
    recover: (journal: TJournal) => Promise<void>,
    operation: (context: FileTransitionContext<TJournal>) => Promise<T>,
  ): Promise<T> {
    return withRecoverableFileLock(this.lockPath, async () => {
      await this.recoverUnlocked(recover);
      return operation({
        commit: (journal, complete, afterJournalWritten) =>
          this.commitUnlocked(journal, complete, afterJournalWritten),
      });
    });
  }

  async recover(complete: (journal: TJournal) => Promise<void>): Promise<boolean> {
    if ((await this.readJournal()) === null) return false;
    return withRecoverableFileLock(this.lockPath, () => this.recoverUnlocked(complete));
  }

  private async commitUnlocked(
    journal: TJournal,
    complete: (journal: TJournal) => Promise<void>,
    afterJournalWritten?: (journal: TJournal) => void | Promise<void>,
  ): Promise<void> {
    await atomicWriteJson(this.journalPath, journal);
    await afterJournalWritten?.(journal);
    await complete(journal);
    await this.removeJournal();
  }

  private async recoverUnlocked(complete: (journal: TJournal) => Promise<void>): Promise<boolean> {
    const journal = await this.readJournal();
    if (journal === null) return false;
    await complete(journal);
    await this.removeJournal();
    return true;
  }

  private async readJournal(): Promise<TJournal | null> {
    try {
      const value = await readFileRaceSafe(this.journalPath, MAX_JOURNAL_BYTES);
      return JSON.parse(value.bytes.toString('utf8')) as TJournal;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async removeJournal(): Promise<void> {
    try {
      await unlinkWithRetry(this.journalPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
