import { SURVEYS } from "./surveys";
import type { SurveyData } from "../types";

export interface LoadProgress {
  name: string;
  surveyIndex: number;
  surveyCount: number;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image ${url}`));
    image.src = url;
  });
}

/**
 * Fetches every survey's PNG up-front (see docs/web-viewer-spec.md: "起動時に
 * 全サーベイを一括プリロード"). Failures for a single survey (e.g. the color
 * survey not having been downloaded yet) are logged and skipped rather than
 * aborting the whole load.
 */
export async function loadAllSurveys(
  onProgress?: (progress: LoadProgress) => void,
): Promise<Map<string, SurveyData>> {
  const result = new Map<string, SurveyData>();

  for (let i = 0; i < SURVEYS.length; i++) {
    const config = SURVEYS[i]!;
    onProgress?.({ name: config.name, surveyIndex: i, surveyCount: SURVEYS.length });
    try {
      const image = await loadImage(config.rawUrl);
      result.set(config.name, { config, image });
    } catch (err) {
      console.error(`[survey] failed to load ${config.name}:`, err);
    }
  }

  return result;
}
