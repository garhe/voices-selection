export type ImportedFile = { file: File; path: string };

export async function droppedFiles(data: {
  items: Iterable<Pick<DataTransferItem, 'kind' | 'webkitGetAsEntry'>>;
  files: Iterable<File>;
}): Promise<ImportedFile[]> {
  const items = Array.from(data.items).filter(item => item.kind === 'file');
  const entries = items.map(item => item.webkitGetAsEntry?.() ?? null);
  const files = Array.from(data.files);
  if (!entries.some(Boolean)) return files.map(file => ({ file, path: file.webkitRelativePath || file.name }));
  if (entries.some(entry => !entry)) throw new Error('Some dropped files could not be read. Drop them separately or use Select folder.');
  const result: ImportedFile[] = [];
  async function visit(entry: FileSystemEntry, parent = ''): Promise<void> {
    const path = `${parent}${entry.name}`;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      result.push({ file, path });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await visit(child, `${path}/`);
      }
    } else throw new Error(`Cannot read dropped entry "${path}". Use Select folder instead.`);
  }
  for (const entry of entries) if (entry) await visit(entry);
  return result;
}
