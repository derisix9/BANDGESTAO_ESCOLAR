/* Aplica o modo claro/escuro guardado ANTES do primeiro desenho (evita o "piscar").
   Ficheiro externo: a CSP não permite scripts inline. */
(function () {
  try {
    var m = localStorage.getItem('bandmed:color-mode');
    document.documentElement.setAttribute('data-color-mode', m === 'dark' ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-color-mode', 'light');
  }
})();
