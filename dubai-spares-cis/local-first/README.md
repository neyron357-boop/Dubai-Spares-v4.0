# Local-first storage (iPhone Safari)

This module implements a fully local IndexedDB architecture with manual backup/restore flow.

## Included layers

- `db.ts` — open/upgrade IndexedDB (`dubai-spares-local`, version `1`), create stores and indexes.
- `repositories.ts` — CRUD repositories plus cascade deletions for orders/parts.
- `photoService.ts` — resize/compress photos before persistence, blob/base64 conversion, object URL helpers.
- `backupService.ts` — export JSON backup, preview, import with full overwrite, and post-restore integrity checks.
- `integrityService.ts` — FK validation and orphan photo cleanup.

## Stores

- `orders`
- `parts`
- `priceVariants`
- `suppliers`
- `photos`
- `photoLinks`
- `meta`

## Backup cycle

1. Call `exportBackup()`.
2. Trigger download with `downloadBackupJson(...)`.
3. User stores file in Files/iCloud.
4. Restore later with `previewBackup(...)` and `importBackup(...)`.

## Quick usage

```ts
import { exportBackup, downloadBackupJson, importBackup, previewBackup } from './local-first';

const backup = await exportBackup();
downloadBackupJson(backup);

const preview = await previewBackup(file);
console.log(preview.stats);

await importBackup(file);
```
