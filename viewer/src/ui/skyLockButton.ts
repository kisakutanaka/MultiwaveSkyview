import { ICON_COMPASS } from "./icons";

export function createSkyLockButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "sky-lock-button";
  button.type = "button";
  button.className = "icon-button";
  button.innerHTML = ICON_COMPASS;
  button.title = "実際の空と同期";
  button.setAttribute("aria-label", "実際の空と同期");
  button.addEventListener("click", onClick);
  return button;
}
