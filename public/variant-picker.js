(() => {
  function positionIndicator(group, selected) {
    const indicator = group.querySelector('.variant-indicator');
    if (!indicator || !selected) return;
    indicator.style.width = `${selected.offsetWidth}px`;
    indicator.style.transform = `translateX(${selected.offsetLeft}px)`;
  }

  function initVariantPickers(root = document) {
    root.querySelectorAll('.variant-picker').forEach(group => {
      const choices = [...group.querySelectorAll('.variant-choice')];
      if (!choices.length) return;
      const selected = choices.find(choice => choice.classList.contains('is-selected')) || choices[0];
      choices.forEach(choice => choice.setAttribute('aria-pressed', String(choice === selected)));
      const hiddenInput = group.querySelector(`input[name="${group.dataset.optionName}"]`);
      if (hiddenInput) hiddenInput.value = selected.dataset.value;
      positionIndicator(group, selected);
    });
  }

  document.addEventListener('click', event => {
    const choice = event.target.closest('.variant-choice');
    if (!choice) return;
    const group = choice.closest('.variant-picker');
    if (!group) return;
    group.querySelectorAll('.variant-choice').forEach(option => {
      const active = option === choice;
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-pressed', String(active));
    });
    const hiddenInput = group.querySelector(`input[name="${group.dataset.optionName}"]`);
    if (hiddenInput) hiddenInput.value = choice.dataset.value;
    positionIndicator(group, choice);
  });

  window.initVariantPickers = initVariantPickers;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initVariantPickers());
  } else {
    initVariantPickers();
  }
  window.addEventListener('resize', () => initVariantPickers());
})();
