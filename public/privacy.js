// Сторінка про дані показує мову, вибрану на сайті. Без JavaScript видно всі три версії поспіль.
(function () {
  var langs = ["en", "uk", "ru"];

  function pick() {
    var fromHash = location.hash.slice(1);
    if (langs.indexOf(fromHash) !== -1) return fromHash;
    try {
      var saved = JSON.parse(localStorage.getItem("garage-ui") || "{}").lang;
      if (langs.indexOf(saved) !== -1) return saved;
    } catch (e) {}
    return "en";
  }

  function show() {
    var lang = pick();
    document.documentElement.lang = lang;
    document.documentElement.classList.add("js");
    langs.forEach(function (l) {
      var article = document.getElementById(l);
      if (article) article.hidden = l !== lang;
    });
    var heading = document.querySelector("#" + lang + " h1");
    if (heading) document.title = heading.textContent + ": D.Garage";
  }

  document.addEventListener("DOMContentLoaded", show);
  window.addEventListener("hashchange", show);
})();
