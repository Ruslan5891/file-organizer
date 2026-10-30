# file-organizer

CLI-застосунок на Node.js, який допомагає навести лад у директорії (наприклад, `Downloads`):

- **scan** — рекурсивне сканування директорії та збір статистики про файли (кількість, розміри, типи, вік);
- **duplicates** — пошук файлів з однаковим вмістом через обчислення SHA-256 хешів;
- **organize** — копіювання та сортування файлів по категоріях (Documents, Images, Archives, Code, Videos, Other);
- **cleanup** — пошук та видалення файлів, старіших за вказану кількість днів, з режимом попереднього перегляду (dry run).

Використовуються лише вбудовані модулі Node.js (`fs`, `path`, `crypto`, `events`, `stream`), сторонніх залежностей немає.

## Встановлення

Потрібен Node.js 18 або більш нова версія.

```bash
git clone https://github.com/Ruslan5891/file-organizer.git
cd file-organizer
```

`npm install` не потрібен, бо залежностей немає.

## Запуск

```bash
node file-organizer.js scan /path/to/directory
node file-organizer.js duplicates /path/to/directory
node file-organizer.js organize /source/directory --output /target/directory
node file-organizer.js cleanup /path/to/directory --older-than 90
node file-organizer.js cleanup /path/to/directory --older-than 90 --confirm
```

Через npm scripts (подвійний дефіс `--` передає наступні аргументи в скрипт):

```bash
npm run scan -- /path/to/directory
npm run duplicates -- /path/to/directory
npm run organize -- /source/directory --output /target/directory
npm run cleanup -- /path/to/directory --older-than 90 --confirm
```

Аргументи читаються з `process.argv`: `process.argv[2]` — команда, `process.argv[3]` — шлях до директорії, далі йдуть прапорці.

## Команди

### `scan <directory>`

| Аргумент      | Обов'язковий | Опис                               |
|---------------|--------------|------------------------------------|
| `<directory>` | так          | Директорія, яку потрібно проаналізувати |

Рекурсивно обходить директорію та всі піддиректорії. Для кожного файлу викликається `fs.stat()` — беруться `size` (розмір у байтах) і `mtime` (час останньої модифікації); тип файлу визначається через `path.extname()`.

Звіт містить загальну кількість файлів і сумарний розмір, групування за типом (`Map<extension, {count, totalSize}>`), розподіл за віком (за останні 7 днів, за останні 30 днів, старіші за 90 днів), топ-3 найбільших файли та найстаріший файл.

```text
📂 Scanning: /Users/student/Downloads
Processing... ████████████████████ 247/247 files

📊 Scan Results:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total files: 247
Total size: 1.20 GB

By File Type:
  .pdf    89 files   456.0 MB
  .zip    23 files   234.0 MB
  .png    67 files   187.0 MB
  .docx   45 files   123.0 MB
  .js     12 files    15.0 MB
  (other) 11 files    50.0 MB

File Age:
  Last 7 days:    45 files
  Last 30 days:   89 files
  Older than 90:  56 files

Largest files:
  1. video_lecture.mp4    450.0 MB
  2. archive_backup.zip   156.0 MB
  3. presentation.pptx     89.0 MB

Oldest file: old_report.pdf (modified 365 days ago)
```

### `duplicates <directory>`

| Аргумент      | Обов'язковий | Опис                                |
|---------------|--------------|-------------------------------------|
| `<directory>` | так          | Директорія, в якій шукаються дублікати |

Знаходить файли з абсолютно однаковим вмістом, навіть якщо в них різні назви. Хеш SHA-256 обчислюється функцією `calculateHash()` через `crypto.createHash('sha256')` та `fs.createReadStream()` — файл читається частинами (chunks), тому великі файли не завантажуються в пам'ять повністю.

Файли групуються в `Map<hash, Array<filePath>>`, показуються тільки групи, де `filePaths.length > 1`. Витрачене місце = розмір файлу × (кількість копій − 1).

```text
🔍 Searching for duplicates in: /Users/student/Downloads
Calculating hashes... ████████████████████ 247/247 files

Found 3 duplicate groups (8.7 MB wasted):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Group 1 (3 copies, 3.2 MB each):
  SHA-256: a3f2e1b8c4d5...

  📄 Downloads/lecture.pdf
  📄 Downloads/lecture(1).pdf
  📄 Downloads/backup/lecture_copy.pdf

  Wasted space: 6.4 MB
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💾 Total wasted space: 8.7 MB
```

### `organize <source-directory> --output <target-directory>`

| Аргумент                      | Обов'язковий | Опис                                              |
|-------------------------------|--------------|---------------------------------------------------|
| `<source-directory>`          | так          | Звідки копіювати файли                            |
| `--output <target-directory>` | так          | Куди копіювати; директорії категорій створюються автоматично |

Копіює файли з вихідної директорії в цільову, сортуючи їх по категоріях. Оригінальні файли залишаються на своїх місцях — команда нічого не видаляє з source directory.

| Категорія | Розширення                                    |
|-----------|-----------------------------------------------|
| Documents | `.pdf .docx .doc .txt .md .xlsx .pptx`        |
| Images    | `.png .jpg .jpeg .gif .svg .webp .bmp`        |
| Archives  | `.zip .rar .tar .gz .7z`                      |
| Code      | `.js .py .java .cpp .html .css .json`         |
| Videos    | `.mp4 .avi .mkv .mov .webm`                   |
| Other     | усі нерозпізнані розширення                   |

- директорії категорій створюються через `fs.mkdir(path, { recursive: true })`;
- файли менші за 10 MB копіюються через `fs.copyFile(source, target)`, файли від 10 MB — через streams з `pipeline()` з `stream/promises`;
- якщо файл з такою назвою вже існує (перевірка через `fs.access()`), він не перезаписується — до назви додається номер: `file.pdf` → `file(1).pdf` → `file(2).pdf`.

```text
📦 Organizing: /Users/student/Downloads
Target: /Users/student/Organized

Creating folders...
  ✓ Documents/
  ✓ Images/
  ✓ Archives/
  ✓ Code/
  ✓ Videos/
  ✓ Other/

Copying files... ████████████████████ 247/247

✅ Organization complete!

Summary:
  Documents: 134 files → Organized/Documents/
  Images:     67 files → Organized/Images/
  ...

Total copied: 247 files (1.20 GB)
```

### `cleanup <directory> --older-than <days> [--confirm]`

| Аргумент              | Обов'язковий | Опис                                                         |
|-----------------------|--------------|--------------------------------------------------------------|
| `<directory>`         | так          | Директорія, в якій шукаються старі файли                     |
| `--older-than <days>` | так          | Файли, змінені більше ніж стільки днів тому, вважаються старими |
| `--confirm`           | ні           | Без прапорця — dry run (тільки список); з прапорцем — видалення |

Вік файлу визначається за датою останньої модифікації:

```js
const stats = await fs.stat(filePath);
const fileAge = Date.now() - stats.mtime.getTime();
const daysOld = fileAge / (1000 * 60 * 60 * 24);
```

Без `--confirm` команда тільки показує список файлів і підсумкову статистику, нічого не видаляючи (dry run mode). З `--confirm` після показу списку кожен файл видаляється через `fs.unlink(filePath)`.

```text
🧹 Cleanup: /Users/student/Downloads
Looking for files older than 90 days...

Found 45 files to delete:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

old_report.pdf
  Size: 2.3 MB
  Modified: 120 days ago (2024-09-05)
...
... (42 more files)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 45 files (156.0 MB)

⚠️  DRY RUN MODE: No files were deleted.
To actually delete these files, run with --confirm flag.
```

З `--confirm`:

```text
⚠️  DELETING 45 files (156.0 MB). This action cannot be undone!

Deleting... ████████████████████ 45/45

✅ Cleanup complete!
Deleted: 45 files (156.0 MB freed)
```

## Обробка помилок

Усі операції з файловою системою обгорнуті в `try...catch`, повідомлення залежить від коду помилки:

```text
❌ Error: Directory not found: /path      (ENOENT)
❌ Error: Permission denied: /path        (EACCES)
❌ Unexpected error: <повідомлення>       (інші помилки)
```

Якщо помилка стосується директорії, переданої в команду, програма завершується з кодом `process.exit(1)`. Якщо недоступний окремий файл або піддиректорія, для нього виводиться таке ж повідомлення (для файлу — `❌ Error: File not found: /path`), а обробка решти файлів продовжується.

Некоректні аргументи також завершують програму з кодом `1` і повідомленням `❌ Error: ...`:

| Ситуація                                                  | Повідомлення                                                         |
|-----------------------------------------------------------|----------------------------------------------------------------------|
| команду не вказано                                        | `No command provided. Available commands: ...`                       |
| невідома команда                                          | `Unknown command: <name>. Available commands: ...`                   |
| не вказано шлях до директорії                             | `Directory path is required: <формат команди>`                       |
| замість шляху одразу йде прапорець                        | `Directory path must go right after the command: <формат команди>`   |
| невідомий прапорець (наприклад, `--confrim`)              | `Unknown option: <прапорець>. Usage: <формат команди>`               |
| зайвий аргумент                                           | `Unexpected argument: <аргумент>. Usage: <формат команди>`           |
| прапорець не підходить до команди (`scan ... --confirm`)  | `Option <прапорець> is not supported by "<команда>". Usage: ...`     |
| `--output` або `--older-than` без значення                | `Option --output requires a value: ...` / `Option --older-than requires a value: ...` |
| `organize` без `--output`                                 | `Target directory is required: <формат команди>`                     |
| `cleanup` без `--older-than`                              | `Number of days is required: <формат команди>`                       |
| `--older-than` не є невід'ємним числом                    | `--older-than must be a non-negative number of days, got: ...`       |

## EventEmitter

Кожна команда реалізована як клас, що наслідується від `EventEmitter`. Класи нічого не виводять у консоль — вони лише генерують події, а `file-organizer.js` підписується на них і показує прогрес-бар та результати.

| Клас              | Події                                            |
|-------------------|--------------------------------------------------|
| `Scanner`         | `scan-start`, `file-found`, `scan-complete`      |
| `DuplicateFinder` | `file-processed`, `duplicates-found`             |
| `Organizer`       | `copy-start`, `copy-complete`, `copy-error`      |
| `Cleanup`         | `file-found`, `file-deleted`, `cleanup-complete` |

`cleanup-complete` генерується в обох режимах команди `cleanup`, коли всі операції завершено: у режимі dry run — після пошуку файлів (з `dryRun: true`), з `--confirm` — після видалення.

```js
const scanner = new Scanner();

scanner.on('scan-start', (data) => {
  console.log(`📂 Scanning: ${data.directory}`);
});

scanner.on('file-found', (data) => {
  process.stdout.write(`\r${drawProgressBar(data.processedFiles, data.totalFiles)}`);
});

scanner.on('scan-complete', (statistics) => {
  console.log(`Found ${statistics.totalFiles} files`);
});

await scanner.scan('/path/to/directory');
```

## Структура проєкту

```text
file-organizer/
├── package.json         конфігурація проєкту, "type": "module", npm scripts
├── .gitignore           виключення зайвих файлів з Git
├── README.md            документація
├── file-organizer.js    точка входу: парсинг process.argv, formatSize(), drawProgressBar(), вивід у консоль
└── lib/
    ├── scanner.js       клас Scanner — команда scan (і рекурсивна функція обходу директорій findAllFiles)
    ├── duplicates.js    клас DuplicateFinder і функція calculateHash() — команда duplicates
    ├── organizer.js     клас Organizer і об'єкт categories — команда organize
    └── cleanup.js       клас Cleanup — команда cleanup
```
