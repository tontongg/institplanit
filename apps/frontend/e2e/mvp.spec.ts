import { expect, test } from '@playwright/test';

test('creates an account, a shared sequence and one lesson, then plans it manually', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Créer un compte', exact: true }).click();
  await page.getByLabel('Adresse e-mail').fill(`teacher-${Date.now()}@example.fr`);
  await page.getByLabel('Mot de passe').fill('PhraseLongue-De-Test-2026!');
  await page.getByRole('button', { name: /Créer mon compte/ }).click();

  await page.getByLabel('Nom de la classe').fill('Classe de test CE2 CM1');
  await page.getByLabel('Année scolaire').fill('2026-2027');
  await page.getByLabel('Début').fill('2026-09-01');
  await page.getByLabel('Fin').fill('2027-07-31');
  await page.getByLabel('Académie (code)').fill('PAR');
  const classLevels = page.getByRole('group', { name: 'Niveaux réunis' });
  await classLevels.getByLabel('CE2').check();
  await classLevels.getByLabel('CM1').check();
  await page.getByRole('button', { name: /Créer la classe/ }).click();

  await page.getByLabel('Titre de la séquence').fill('Séquence mutualisée de test');
  await page.getByLabel('Matière').selectOption({ label: 'Français' });
  const sequenceLevels = page.getByRole('group', { name: 'Niveaux concernés' });
  await sequenceLevels.getByLabel('CE2').check();
  await sequenceLevels.getByLabel('CM1').check();
  await page.getByRole('button', { name: /Ajouter la séquence/ }).click();

  await page.getByLabel('Titre de la séance').fill('Séance commune de test');
  await page.getByRole('button', { name: 'Ajouter la séance' }).click();
  await expect(page.getByText('Séance commune de test')).toBeVisible();
  await page.getByRole('link', { name: 'Semaine' }).click();
  const catalogLesson = page.locator('.catalog-item').filter({ hasText: 'Séance commune de test' });
  await catalogLesson.getByRole('checkbox').check();
  await expect(page.locator('.selected-item').filter({ hasText: 'Séance commune de test' })).toBeVisible();
  await page.getByRole('button', { name: /Enregistrer le brouillon/ }).click();
  await expect(page.getByText('Brouillon enregistré.')).toBeVisible();
});