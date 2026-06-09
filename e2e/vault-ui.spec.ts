import { expect, test } from '@playwright/test';

test.use({
  ignoreHTTPSErrors: true
});

test.describe('Weryfikacja deploymentu Vault', () => {
  test('interfejs Vault jest dostepny przez HAProxy', async ({ page }, testInfo) => {
    const response = await page.goto('/ui/', { waitUntil: 'domcontentloaded' });

    expect(response, 'Czy Vault UI odpowiada?').not.toBeNull();
    expect(response?.ok(), `Vault UI returned HTTP ${response?.status()}`).toBeTruthy();
    await expect(page).toHaveTitle(/Vault/i);
    await expect(page).toHaveURL(/\/ui\/vault\/auth(?:[/?#]|$)/);

    await expect(page.getByRole('textbox', { name: 'Username' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

    await testInfo.attach('vault-ui.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });


  test('Odczytanie sekretu z UI', async ({ page }, testInfo) => {
    const vaultUsername = process.env.VAULT_USERNAME;
    const vaultPassword = process.env.VAULT_PASSWORD;
    expect(vaultUsername, 'VAULT_USERNAME must be set').toBeTruthy();
    expect(vaultPassword, 'VAULT_PASSWORD must be set').toBeTruthy();

    await page.goto('/ui/vault/auth');
    await page.getByRole('textbox', { name: 'Username' }).fill(vaultUsername!);
    await page.getByRole('textbox', { name: 'Password' }).fill(vaultPassword!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('cell', { name: 'kv type backend dev.rachuna/' }).click();
    await page.getByRole('link', { name: 'e2e-test Manage secret' }).click();
    await page.getByRole('link', { name: 'Secret', exact: true }).click();
    await page.locator('label').click();
    await expect(page.getByRole('code')).toContainText('{ "TestKey": "TestValue" }');

    await testInfo.attach('vault-secret.png', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
});