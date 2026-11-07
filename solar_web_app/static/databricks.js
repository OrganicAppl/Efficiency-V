const authForms = document.querySelectorAll("[data-auth-form]");

document.querySelector("[data-show-register]")?.addEventListener("click", () => {
  document.querySelector("#login-panel").hidden = true;
  document.querySelector("#register-panel").hidden = false;
});

document.querySelector("[data-show-login]")?.addEventListener("click", () => {
  document.querySelector("#register-panel").hidden = true;
  document.querySelector("#login-panel").hidden = false;
});

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
