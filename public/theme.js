// Тема ставиться до першого малювання, щоб сторінка не блимала. Файл окремий, бо CSP забороняє вбудовані скрипти.
try {
  var theme = JSON.parse(localStorage.getItem("garage-ui") || "{}").theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
} catch (e) {}
