import { ICON_SLIDERS } from "./icons";

/** Toggle button for developer/debug tools (sensor readout, heading check, compass-ring-only check, colormap picker) - hidden by default so the exhibit UI stays minimal, shown only when needed. */
export function createDebugToggle(target: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "debug-toggle-button";
  button.type = "button";
  button.className = "icon-button";
  button.innerHTML = ICON_SLIDERS;

  function render(): void {
    const active = target.classList.contains("debug-visible");
    button.classList.toggle("active", active);
    button.title = active ? "デバッグ表示を隠す" : "デバッグ表示";
    button.setAttribute("aria-label", button.title);
  }

  button.addEventListener("click", () => {
    target.classList.toggle("debug-visible");
    render();
  });

  render();
  return button;
}
