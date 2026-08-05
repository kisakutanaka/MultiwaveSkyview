export interface FovSliderOptions {
  min: number;
  max: number;
  initial: number;
  onChange: (fovDeg: number) => void;
}

/** Vertical field-of-view slider, right edge of the screen: drag up for a wider view, down to zoom in. A plain range input rotated via CSS (see style.css) rather than a custom widget. */
export function createFovSlider(options: FovSliderOptions): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.id = "fov-slider";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = "1";
  input.value = String(options.initial);
  input.setAttribute("aria-label", "画角");
  input.addEventListener("input", () => options.onChange(Number(input.value)));
  return input;
}
