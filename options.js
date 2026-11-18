const api = typeof browser !== 'undefined' ? browser : chrome;
const DEFAULT_DICTIONARY = [
  'Авдотья=Евдокия', 'Овдотья=Евдокия', 'Аграфена=Агриппина', 'Агрофена=Агриппина',
  'Аксинья=Ксения', 'Акулина=Акилина', 'Арина=Ирина', 'Афанасей=Афанасий',
  'Василей=Василий', 'Гаврила=Гавриил', 'Гаврило=Гавриил', 'Григорей=Григорий',
  'Давыд=Давид', 'Данила=Даниил', 'Данило=Даниил', 'Егор=Георгий', 'Егорий=Георгий',
  'Емельян=Емилиан', 'Козма=Косьма', 'Кузма=Косьма', 'Кузьма=Косьма',
  'Лукерья=Гликерия', 'Маланья=Мелания', 'Марья=Мария', 'Матрена=Матрона',
  'Михайла=Михаил', 'Михайло=Михаил', 'Настасья=Анастасия', 'Осип=Иосиф',
  'Палагея=Пелагея', 'Прасковья=Параскева', 'Семен=Симеон', 'Степан=Стефан',
  'Ульяна=Иулиания', 'Федор=Феодор', 'Феврония=Февронья'
].join('\n');

const DEFAULT_SETTINGS = {
  textMode: 'substitute',
  stitchMode: 'joined',
  fixOldSpelling: true,
  substitutePatronymic: true,
  substituteBirthYear: true,
  nameDictionary: DEFAULT_DICTIONARY,
  borderWidth: 2,
  buttonsPosition: 'bottom',
  enabledButtons: ['copy_sel_clip', 'copy_sel_new_file', 'copy_sel_open_file', 'copy_all_clip', 'copy_all_new_file', 'copy_all_open_file'],
  theme: 'system',
  textColor: '#1f2328',
  selectionBgColor: '#ffd33d',
  selectionTextColor: '#000000'
};

function populateForm(data) {
  document.getElementById('textMode').value = data.textMode;
  document.getElementById('stitchMode').value = data.stitchMode;
  document.getElementById('fixOldSpelling').checked = data.fixOldSpelling;
  document.getElementById('substitutePatronymic').checked = data.substitutePatronymic;
  document.getElementById('substituteBirthYear').checked = data.substituteBirthYear;
  document.getElementById('nameDictionary').value = data.nameDictionary;
  document.getElementById('borderWidth').value = data.borderWidth;
  document.getElementById('buttonsPosition').value = data.buttonsPosition;
  document.getElementById('theme').value = data.theme;
  document.getElementById('textColor').value = data.textColor;
  document.getElementById('selectionBgColor').value = data.selectionBgColor;
  document.getElementById('selectionTextColor').value = data.selectionTextColor;
  document.querySelectorAll('input[name="enabledButtons"]').forEach((cb) => {
    cb.checked = data.enabledButtons.includes(cb.value);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const data = await api.storage.local.get(DEFAULT_SETTINGS);
  populateForm(data);
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const enabledButtons = Array.from(document.querySelectorAll('input[name="enabledButtons"]:checked')).map((cb) => cb.value);
  const settings = {
    textMode: document.getElementById('textMode').value,
    stitchMode: document.getElementById('stitchMode').value,
    fixOldSpelling: document.getElementById('fixOldSpelling').checked,
    substitutePatronymic: document.getElementById('substitutePatronymic').checked,
    substituteBirthYear: document.getElementById('substituteBirthYear').checked,
    nameDictionary: document.getElementById('nameDictionary').value,
    borderWidth: Math.max(1, Math.min(15, parseInt(document.getElementById('borderWidth').value, 10) || 2)),
    buttonsPosition: document.getElementById('buttonsPosition').value,
    enabledButtons,
    theme: document.getElementById('theme').value,
    textColor: document.getElementById('textColor').value,
    selectionBgColor: document.getElementById('selectionBgColor').value,
    selectionTextColor: document.getElementById('selectionTextColor').value
  };
  await api.storage.local.set(settings);
  const status = document.getElementById('status');
  status.textContent = 'Настройки сохранены!';
  setTimeout(() => { status.textContent = ''; }, 3000);
});

document.getElementById('resetBtn').addEventListener('click', async () => {
  await api.storage.local.set(DEFAULT_SETTINGS);
  populateForm(DEFAULT_SETTINGS);
  const status = document.getElementById('status');
  status.textContent = 'Настройки сброшены.';
  setTimeout(() => { status.textContent = ''; }, 3000);
});
