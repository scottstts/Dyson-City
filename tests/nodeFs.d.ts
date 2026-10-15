/** The few Node built-ins the asset tests read files with (the project carries no @types/node). */
declare module 'node:fs' {
  interface Bytes extends Uint8Array {
    toString(encoding: 'ascii' | 'utf8', start?: number, end?: number): string;
    readUInt32LE(offset: number): number;
    subarray(start?: number, end?: number): Bytes;
  }
  const fs: { existsSync(path: string | URL): boolean; readFileSync(path: string | URL): Bytes };
  export default fs;
}
