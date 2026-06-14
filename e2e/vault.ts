import { APIRequestContext, APIResponse, TestInfo, expect } from '@playwright/test';
import { isIP } from 'node:net';
import tls from 'node:tls';

export interface VaultHealth {
  initialized: boolean;
  sealed: boolean;
  standby: boolean;
  performance_standby: boolean;
  server_time_utc: number;
  version: string;
  cluster_name: string;
  cluster_id: string;
}

export interface VaultLeader {
  ha_enabled: boolean;
  is_self: boolean;
  leader_address: string;
  leader_cluster_address: string;
}

interface VaultKvV2Response {
  data: {
    data: Record<string, unknown>;
  };
}

export interface VaultCredentials {
  username: string;
  password: string;
}

export interface TlsCertificateStatus {
  trusted: boolean;
  authorizationError: string | null;
  subject: Record<string, string>;
  issuer: Record<string, string>;
  validFrom: string;
  validTo: string;
  fingerprint256: string;
  subjectAltName: string;
}

export const vaultAddress = process.env.VAULT_ADDR ?? 'https://vault.rachuna.dev';
export const vaultCredentialsPath =
  process.env.VAULT_CREDENTIALS_PATH ?? 'users/defaults_passwords/tech_user';
export const vaultUsername = process.env.VAULT_USERNAME ?? 'tech_user';

const defaultVaultNodeUrls = [
  'https://vault-1005.rachuna.dev:8200',
  'https://vault-1006.rachuna.dev:8200',
  'https://vault-1007.rachuna.dev:8200',
];

export const vaultNodeUrls = process.env.VAULT_NODE_URLS
  ? process.env.VAULT_NODE_URLS.split(',')
      .map((url) => url.trim())
      .filter(Boolean)
  : defaultVaultNodeUrls;

export const ignoreHTTPSErrors =
  (process.env.VAULT_TLS_SKIP_VERIFY ?? 'true').toLowerCase() === 'true';

export async function getTlsCertificateStatus(address: string): Promise<TlsCertificateStatus> {
  const url = new URL(address);

  if (url.protocol !== 'https:') {
    throw new Error(`${address} does not use HTTPS`);
  }

  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: url.hostname,
      port: Number(url.port || 443),
      rejectUnauthorized: false,
      servername: isIP(url.hostname) ? undefined : url.hostname,
    });

    socket.setTimeout(10_000, () => {
      socket.destroy(new Error(`TLS connection to ${url.host} timed out`));
    });
    socket.once('error', reject);
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const status: TlsCertificateStatus = {
        trusted: socket.authorized,
        authorizationError: socket.authorizationError
          ? String(socket.authorizationError)
          : null,
        subject: certificate.subject ?? {},
        issuer: certificate.issuer ?? {},
        validFrom: certificate.valid_from ?? '',
        validTo: certificate.valid_to ?? '',
        fingerprint256: certificate.fingerprint256 ?? '',
        subjectAltName: certificate.subjectaltname ?? '',
      };

      socket.end();
      resolve(status);
    });
  });
}

export async function parseJson<T>(
  response: APIResponse,
  testInfo: TestInfo,
  attachmentName: string,
): Promise<T> {
  const body = await response.text();

  await testInfo.attach(attachmentName, {
    body,
    contentType: response.headers()['content-type'] ?? 'application/json',
  });

  expect(response.ok(), `${response.url()} returned HTTP ${response.status()}`).toBeTruthy();

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`${response.url()} did not return valid JSON: ${body}`);
  }
}

export async function getHealth(
  request: APIRequestContext,
  baseURL: string,
  testInfo: TestInfo,
  attachmentName: string,
): Promise<VaultHealth> {
  const response = await request.get(`${baseURL}/v1/sys/health`, {
    params: {
      standbyok: 'true',
      perfstandbyok: 'true',
      sealedcode: '503',
      uninitcode: '503',
    },
  });

  return parseJson<VaultHealth>(response, testInfo, attachmentName);
}

export async function getVaultCredentials(
  request: APIRequestContext,
): Promise<VaultCredentials> {
  const token = process.env.VAULT_TOKEN;

  if (!token) {
    throw new Error('VAULT_TOKEN must be set');
  }

  const [mount, ...secretPathParts] = vaultCredentialsPath.split('/');
  const secretPath = secretPathParts.map(encodeURIComponent).join('/');
  const response = await request.get(
    `${vaultAddress}/v1/${encodeURIComponent(mount)}/data/${secretPath}`,
    { headers: { 'X-Vault-Token': token } },
  );

  if (!response.ok()) {
    throw new Error(
      `Cannot read Vault secret ${vaultCredentialsPath}: HTTP ${response.status()} ${response.statusText()}`,
    );
  }

  const payload = (await response.json()) as VaultKvV2Response;
  const username = payload.data?.data?.username ?? vaultUsername;
  const password = payload.data?.data?.password;

  if (typeof username !== 'string' || !username) {
    throw new Error(`Vault secret ${vaultCredentialsPath} must contain a non-empty username key`);
  }
  if (typeof password !== 'string' || !password) {
    throw new Error(`Vault secret ${vaultCredentialsPath} must contain a non-empty password key`);
  }

  return { username, password };
}
