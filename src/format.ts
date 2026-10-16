// How the commands say figures to a person or a model: aligned tables, GiB, percents, hours and minutes, UTC times.

// Rows of cells as lines whose columns are aligned, two spaces at least between them; a row's last cell is not padded.
export function table(rows: string[][]): string[] {
  const widths = rows.reduce<number[]>((at, row) => row.map((cell, column) => Math.max(at[column] ?? 0, cell.length)), []);
  return rows.map((row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]!))).join('  '));
}

const GIB = 1024 ** 3;
export const gib = (bytes: number | undefined): string => (bytes === undefined ? '-' : `${(bytes / GIB).toFixed(1)} GiB`);
export const percent = (fraction: number | undefined): string => (fraction === undefined ? '-' : `${(fraction * 100).toFixed(1)}%`);
export const uptime = (seconds: number | undefined): string =>
  (seconds === undefined || seconds <= 0 ? '-' : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`);
export const utc = (seconds: number): string => `${new Date(seconds * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
