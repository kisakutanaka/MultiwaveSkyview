import type { LayerState, SurveyConfig } from "../types";

export interface ColormapPanelOptions {
  surveys: SurveyConfig[];
  colormapNames: string[];
  initialLayerA: LayerState;
  initialLayerB: LayerState;
  onColormapChange: (slot: "A" | "B", colormap: string) => void;
}

export interface ColormapPanel {
  element: HTMLDivElement;
  /** Call when the survey for `slot` changes elsewhere (layerBar) so this panel can disable the colormap picker for RGB "color" surveys, which ignore it. */
  setSurvey: (slot: "A" | "B", surveyName: string) => void;
}

function surveyKind(surveys: SurveyConfig[], name: string): "scalar" | "color" {
  return surveys.find((s) => s.name === name)?.kind ?? "scalar";
}

function buildLayerFieldset(
  slot: "A" | "B",
  options: ColormapPanelOptions,
  state: LayerState,
): { fieldset: HTMLFieldSetElement; select: HTMLSelectElement } {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `レイヤー ${slot}`;
  fieldset.appendChild(legend);

  const select = document.createElement("select");
  for (const name of options.colormapNames) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = state.colormap;
  select.addEventListener("input", () => options.onColormapChange(slot, select.value));

  const label = document.createElement("label");
  label.textContent = "colormap";
  label.appendChild(select);
  fieldset.appendChild(label);

  return { fieldset, select };
}

/**
 * Dev-only tool for picking a colormap per layer - not part of the exhibit
 * UI (survey selection + blend live in layerBar.ts instead). Will likely go
 * away once surveys ship as pre-colorized PNGs; kept separate and minimal
 * until then rather than building it out further.
 */
export function createColormapPanel(options: ColormapPanelOptions): ColormapPanel {
  const element = document.createElement("div");
  element.id = "colormap-panel";

  const a = buildLayerFieldset("A", options, options.initialLayerA);
  const b = buildLayerFieldset("B", options, options.initialLayerB);
  element.appendChild(a.fieldset);
  element.appendChild(b.fieldset);

  const selects: Record<"A" | "B", HTMLSelectElement> = { A: a.select, B: b.select };

  function setSurvey(slot: "A" | "B", surveyName: string): void {
    selects[slot].disabled = surveyKind(options.surveys, surveyName) === "color";
  }

  setSurvey("A", options.initialLayerA.surveyName);
  setSurvey("B", options.initialLayerB.surveyName);

  return { element, setSurvey };
}
