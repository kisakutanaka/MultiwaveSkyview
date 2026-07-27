import type { LayerState, SurveyConfig } from "../types";

export interface DebugPanelOptions {
  surveys: SurveyConfig[];
  colormapNames: string[];
  initialLayerA: LayerState;
  initialLayerB: LayerState;
  initialBlend: number;
  onLayerChange: (slot: "A" | "B", state: LayerState) => void;
  onBlendChange: (value: number) => void;
}

function surveyKind(surveys: SurveyConfig[], name: string): "scalar" | "color" {
  return surveys.find((s) => s.name === name)?.kind ?? "scalar";
}

function buildLayerFieldset(slot: "A" | "B", options: DebugPanelOptions, state: LayerState): HTMLFieldSetElement {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = `レイヤー ${slot}`;
  fieldset.appendChild(legend);

  const surveySelect = document.createElement("select");
  for (const survey of options.surveys) {
    const opt = document.createElement("option");
    opt.value = survey.name;
    opt.textContent = survey.label;
    surveySelect.appendChild(opt);
  }
  surveySelect.value = state.surveyName;

  const colormapSelect = document.createElement("select");
  for (const name of options.colormapNames) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    colormapSelect.appendChild(opt);
  }
  colormapSelect.value = state.colormap;

  function updateDisabledState(): void {
    // Colormap only applies to pre-stretched grayscale surveys; RGB color
    // surveys are sampled as-is.
    colormapSelect.disabled = surveyKind(options.surveys, surveySelect.value) === "color";
  }

  function currentState(): LayerState {
    return {
      surveyName: surveySelect.value,
      colormap: colormapSelect.value,
    };
  }

  function handleChange(): void {
    updateDisabledState();
    options.onLayerChange(slot, currentState());
  }

  surveySelect.addEventListener("change", handleChange);
  colormapSelect.addEventListener("input", handleChange);

  const label = (text: string, el: HTMLElement) => {
    const wrapper = document.createElement("label");
    wrapper.textContent = text;
    wrapper.appendChild(el);
    return wrapper;
  };

  fieldset.appendChild(label("サーベイ", surveySelect));
  fieldset.appendChild(label("colormap", colormapSelect));

  updateDisabledState();

  return fieldset;
}

export function createDebugPanel(options: DebugPanelOptions): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = "debug-panel";

  const fieldsetA = buildLayerFieldset("A", options, options.initialLayerA);
  const fieldsetB = buildLayerFieldset("B", options, options.initialLayerB);

  const blendFieldset = document.createElement("fieldset");
  const blendLegend = document.createElement("legend");
  blendLegend.textContent = "クロスフェード (A -> B)";
  blendFieldset.appendChild(blendLegend);

  const blendInput = document.createElement("input");
  blendInput.type = "range";
  blendInput.min = "0";
  blendInput.max = "1";
  blendInput.step = "0.01";
  blendInput.value = String(options.initialBlend);
  blendInput.addEventListener("input", () => {
    options.onBlendChange(Number(blendInput.value));
  });

  const blendLabel = document.createElement("label");
  blendLabel.textContent = "blend";
  blendLabel.appendChild(blendInput);
  blendFieldset.appendChild(blendLabel);

  panel.appendChild(fieldsetA);
  panel.appendChild(fieldsetB);
  panel.appendChild(blendFieldset);

  return panel;
}
