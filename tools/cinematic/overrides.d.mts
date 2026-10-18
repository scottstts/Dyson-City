export interface CaptureOverride {
  file: string;
  find: string;
  replace: string;
}
export const OVERRIDES: readonly CaptureOverride[];
export function captureOverrides(): unknown;
