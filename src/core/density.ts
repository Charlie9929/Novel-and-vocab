export type DensityLevel = "low" | "medium" | "high";

export const DENSITY_VALUES: Record<DensityLevel, number> = {
  low: 0.15,
  medium: 0.35,
  high: 0.8,
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
