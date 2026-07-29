import { ICON_EYE, ICON_EYE_OFF } from "./icons";

/** Toggle button for hiding all UI chrome (layer bar + icon buttons, and any open debug tools) for unobstructed sky viewing. The toggle itself always stays visible so it can be un-hidden. */
export function createUiVisibilityToggle(target: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "ui-toggle-button";
  button.type = "button";
  button.className = "icon-button";

  function render(): void {
    const hidden = target.classList.contains("ui-hidden");
    button.innerHTML = hidden ? ICON_EYE_OFF : ICON_EYE;
    button.title = hidden ? "UI表示" : "UI非表示";
    button.setAttribute("aria-label", button.title);
  }

  button.addEventListener("click", () => {
    target.classList.toggle("ui-hidden");
    render();
  });

  render();
  return button;
}
