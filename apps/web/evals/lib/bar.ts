import thresholds from "../../../../evals/suites/morgan_naturalness/bar.thresholds.json";

export interface BarAxis {
  metric: string;
  band: readonly [number, number];
  status: string;
  measurement_only?: boolean;
}

export type BarAxes = Record<string, BarAxis>;

function parseAxes(value: unknown): BarAxes {
  if (typeof value !== "object" || value === null || !("axes" in value)) {
    throw new Error("Morgan naturalness bar is missing axes");
  }

  const axes = (value as { axes: unknown }).axes;
  if (typeof axes !== "object" || axes === null) {
    throw new Error("Morgan naturalness bar axes must be an object");
  }

  for (const [name, rawAxis] of Object.entries(axes)) {
    if (typeof rawAxis !== "object" || rawAxis === null) {
      throw new Error(`Morgan naturalness axis ${name} must be an object`);
    }
    const axis = rawAxis as Record<string, unknown>;
    const band = axis.band;
    if (
      typeof axis.metric !== "string" ||
      !Array.isArray(band) ||
      band.length !== 2 ||
      !band.every((bound) => typeof bound === "number") ||
      typeof axis.status !== "string" ||
      (axis.measurement_only !== undefined &&
        typeof axis.measurement_only !== "boolean")
    ) {
      throw new Error(`Morgan naturalness axis ${name} has an invalid schema`);
    }
  }

  return axes as BarAxes;
}

export const barAxes = parseAxes(thresholds);
