export function createSkyLockButton(onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "sky-lock-button";
  button.type = "button";
  button.textContent = "実際の空と同期";
  button.addEventListener("click", onClick);
  return button;
}
