import { request as playwrightRequest, expect, test } from '@playwright/test';
import {
  getHealth,
  getTlsCertificateStatus,
  ignoreHTTPSErrors,
  parseJson,
  vaultAddress,
  vaultNodeUrls,
} from './vault';
import type { VaultHealth, VaultLeader } from './vault';

test.describe('Weryfikacja deploymentu Vault', () => {
  test(`Sprawdzenie healthcheck dla ${vaultAddress}`, async ({ request }, testInfo) => {
    const health = await getHealth(request, vaultAddress, testInfo, 'public-health.json');

    const role = health.performance_standby
      ? 'performance_standby'
      : health.standby
        ? 'standby'
        : 'active';
    console.log(
      `[Vault] Klaster: ${health.cluster_name}, wersja: ${health.version}, rola endpointu: ${role}`,
    );

    expect(health.initialized).toBe(true);
    expect(health.sealed).toBe(false);
    expect(health.cluster_id).not.toBe('');
    expect(health.cluster_name).not.toBe('');
    expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test(`Czy certyfikat TLS dla ${vaultAddress} jest zaufany?`, async ({}, testInfo) => {
    const certificate = await getTlsCertificateStatus(vaultAddress);

    await testInfo.attach('tls-certificate.json', {
      body: JSON.stringify(certificate, null, 2),
      contentType: 'application/json',
    });

    console.log(
      `[Vault] Certyfikat TLS: trusted=${certificate.trusted}, issuer=${certificate.issuer.CN ?? 'unknown'}, validTo=${certificate.validTo}`,
    );

    expect(
      certificate.trusted,
      `Certyfikat TLS nie jest zaufany: ${certificate.authorizationError ?? 'unknown error'}`,
    ).toBe(true);
  });

  test('Sprawdzenie wybranego lidera', async ({ request }, testInfo) => {
    const response = await request.get(`${vaultAddress}/v1/sys/leader`);
    const leader = await parseJson<VaultLeader>(response, testInfo, 'leader.json');

    console.log(`[Vault] Wybrany lider: ${leader.leader_address}`);
    console.log(`[Vault] Adres komunikacji klastra: ${leader.leader_cluster_address}`);

    expect(leader.ha_enabled).toBe(true);
    expect(leader.leader_address).toMatch(/^https?:\/\//);
    expect(leader.leader_cluster_address).toMatch(/^https?:\/\//);
  });

  test('Czy trzy nody RAFT sa zdrowe: jeden active i dwa standby?', async ({}, testInfo) => {
    expect(vaultNodeUrls, 'VAULT_NODE_URLS must contain exactly three node URLs').toHaveLength(3);

    const contexts = await Promise.all(
      vaultNodeUrls.map((baseURL) =>
        playwrightRequest.newContext({ baseURL, ignoreHTTPSErrors }),
      ),
    );

    try {
      const results = await Promise.allSettled(
        contexts.map((context, index) =>
          getHealth(
            context,
            vaultNodeUrls[index],
            testInfo,
            `node-${index + 1}-health.json`,
          ),
        ),
      );
      const failures = results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [{ node: vaultNodeUrls[index], error: String(result.reason) }]
          : [],
      );

      if (failures.length > 0) {
        await testInfo.attach('unavailable-nodes.json', {
          body: JSON.stringify(failures, null, 2),
          contentType: 'application/json',
        });
      }

      expect(failures, 'Every configured Vault node must be reachable').toEqual([]);

      const healthChecks = results
        .filter((result): result is PromiseFulfilledResult<VaultHealth> =>
          result.status === 'fulfilled',
        )
        .map((result) => result.value);

      console.log('[Vault] Stan nodów RAFT:');
      healthChecks.forEach((health, index) => {
        const role = health.standby ? 'standby' : 'active';
        console.log(
          `[Vault]   ${vaultNodeUrls[index]} -> ${role}, sealed=${health.sealed}, wersja=${health.version}`,
        );
      });

      for (const health of healthChecks) {
        expect(health.initialized).toBe(true);
        expect(health.sealed).toBe(false);
        expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
      }

      expect(healthChecks.filter((health) => !health.standby)).toHaveLength(1);
      expect(healthChecks.filter((health) => health.standby)).toHaveLength(2);
      expect(new Set(healthChecks.map((health) => health.cluster_id)).size).toBe(1);
      expect(new Set(healthChecks.map((health) => health.cluster_name)).size).toBe(1);
      expect(new Set(healthChecks.map((health) => health.version)).size).toBe(1);
    } finally {
      await Promise.all(contexts.map((context) => context.dispose()));
    }
  });
});
