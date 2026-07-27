/** Toggle button for hiding the debug panel + sky-lock button (e.g. for kiosk/exhibit display). The toggle itself always stays visible. */
export function createUiVisibilityToggle(target: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = "ui-toggle-button";
  button.type = "button";

  function render(): void {
    const hidden = target.classList.contains("ui-hidden");
    button.textContent = hidden ? "UI表示" : "UI非表示";
  }

  button.addEventListener("click", () => {
    target.classList.toggle("ui-hidden");
    render();
  });

  render();
  return button;
}
