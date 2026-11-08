const authForms = document.querySelectorAll("[data-auth-form]");
const authTabs = Array.from(document.querySelectorAll("[data-auth-tab]"));

function selectAuthTab(tab, focus = false) {
  for (const other of authTabs) {
    const selected = other === tab;
    other.setAttribute("aria-selected", String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
  }
  if (focus) tab.focus();
}

for (const tab of authTabs) {
  tab.addEventListener("click", () => selectAuthTab(tab));
  tab.addEventListener("keydown", (event) => {
    const index = authTabs.indexOf(tab);
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = authTabs[(index + 1) % authTabs.length];
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = authTabs[(index - 1 + authTabs.length) % authTabs.length];
    if (event.key === "Home") next = authTabs[0];
    if (event.key === "End") next = authTabs[authTabs.length - 1];
    if (!next) return;
    event.preventDefault();
    selectAuthTab(next, true);
  });
}

for (const form of authForms) {
  const message = form.querySelector('[role="alert"]');
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        message.textContent = result.error || "Unable to continue. Please try again.";
        return;
      }

      window.location.assign("/");
    } catch {
      message.textContent = "Unable to contact the login service. Please try again.";
    } finally {
      submitButton.disabled = false;
    }
  });
}
