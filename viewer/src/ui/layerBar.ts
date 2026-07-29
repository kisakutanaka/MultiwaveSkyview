import type { LayerState, SurveyConfig } from "../types";

export interface LayerBarOptions {
  surveys: SurveyConfig[];
  initialLayerA: LayerState;
  initialLayerB: LayerState;
  initialBlend: number;
  onSurveyChange: (slot: "A" | "B", surveyName: string) => void;
  onBlendChange: (value: number) => void;
}

function buildSurveySelect(slot: "A" | "B", options: LayerBarOptions, initial: LayerState): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = `layer-select layer-select-${slot.toLowerCase()}`;
  select.setAttribute("aria-label", `レイヤー ${slot}`);
  for (const survey of options.surveys) {
    const opt = document.createElement("option");
    opt.value = survey.name;
    opt.textContent = survey.label;
    select.appendChild(opt);
  }
  select.value = initial.surveyName;
  select.addEventListener("change", () => options.onSurveyChange(slot, select.value));
  return select;
}

/** Minimal production/exhibit UI: survey picker for layer A (left) and layer B (right), with the A->B crossfade slider between them. Kept deliberately small so the sky itself stays the focus of the screen. */
export function createLayerBar(options: LayerBarOptions): HTMLDivElement {
  const bar = document.createElement("div");
  bar.id = "layer-bar";

  const selectA = buildSurveySelect("A", options, options.initialLayerA);
  const selectB = buildSurveySelect("B", options, options.initialLayerB);

  const blendInput = document.createElement("input");
  blendInput.type = "range";
  blendInput.id = "layer-blend";
  blendInput.min = "0";
  blendInput.max = "1";
  blendInput.step = "0.01";
  blendInput.value = String(options.initialBlend);
  blendInput.setAttribute("aria-label", "クロスフェード (A -> B)");
  blendInput.addEventListener("input", () => options.onBlendChange(Number(blendInput.value)));

  bar.appendChild(selectA);
  bar.appendChild(blendInput);
  bar.appendChild(selectB);

  return bar;
}
