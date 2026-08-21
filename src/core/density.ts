export type DensityLevel = "low" | "medium" | "high";

export const DENSITY_VALUES: Record<DensityLevel, number> = {
  // Density is the share of the maximal safe vocabulary pool.  The pool is
  // built once, so the three levels are nested and visibly different without
  // introducing lower-confidence words at higher settings.
  low: 1 / 3,
  medium: 2 / 3,
  high: 1,
};

export const DENSITY_LABELS: Record<DensityLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

export const DENSITY_DISPLAY_LABELS: Record<DensityLevel, string> = {
  low: "低密度",
  medium: "中密度",
  high: "高密度",
};

export const DEFAULT_DENSITY: DensityLevel = "medium";

export function densityClassName(level: DensityLevel): string {
  return `density-${level}`;
}
