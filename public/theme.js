// Тема й мова ставляться до першого малювання, щоб сторінка не блимала. Файл окремий, бо CSP забороняє вбудовані скрипти.
(function () {
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var ui = {};
  try {
    ui = JSON.parse(localStorage.getItem("garage-ui") || "{}") || {};
  } catch (e) {}
  if (ui.lang === "uk" || ui.lang === "ru") document.documentElement.lang = ui.lang;

  function apply() {
    var theme;
    try {
      theme = JSON.parse(localStorage.getItem("garage-ui") || "{}").theme;
    } catch (e) {}
    if (theme !== "light" && theme !== "dark") theme = media.matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  }

  apply();
  media.addEventListener("change", apply);
  window.garageApplyTheme = apply;
})();
