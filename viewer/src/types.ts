export interface SurveyConfig {
  // "scalar": a pre-stretched grayscale PNG (from convert_allsky_png.py) -
  //   the colormap LUT is applied to its gray value.
  // "color": a pre-rendered RGB PNG, sampled directly (no colormap).
  kind: "scalar" | "color";
  name: string;
  label: string;
  rawUrl: string;
}

export interface SurveyData {
  config: SurveyConfig;
  image: HTMLImageElement;
}

export interface LayerState {
  surveyName: string;
  colormap: string;
}
