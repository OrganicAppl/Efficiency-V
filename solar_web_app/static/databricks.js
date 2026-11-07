const loginForm = document.querySelector("#login-form");

if (loginForm) {
  const message = document.querySelector("#login-message");
  const submitButton = loginForm.querySelector('button[type="submit"]');

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    try {
      const response = await fetch(loginForm.action, {
        method: "POST",
        body: new FormData(loginForm),
        headers: { Accept: "application/json" },
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        message.textContent = result.error || "Unable to log in. Please try again.";
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
