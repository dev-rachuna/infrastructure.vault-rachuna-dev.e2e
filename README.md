# Testy smoke klastra HashiCorp Vault

Ten projekt sprawdza, czy deployment trzywęzłowego klastra Vault zakończył się
poprawnie i czy klaster jest gotowy do obsługi klientów.

Testy są bezpieczne: wykonują wyłącznie żądania odczytowe i nie wymagają tokenu
Vault. Nie zapisują ani nie usuwają sekretów.

## Co jest sprawdzane?

| Test | Co sprawdza? | Dlaczego jest ważny? |
|---|---|---|
| Publiczny endpoint Vault | Odpytuje `https://vault.rachuna.dev/v1/sys/health` i potwierdza, że Vault jest zainicjalizowany, odpieczętowany i że publiczny adres prowadzi do aktywnego noda. | Klienci muszą mieć dostęp do działającego lidera przez główny adres usługi. |
| Certyfikat TLS | Sprawdza, czy certyfikat publicznego endpointu jest zaufany przez magazyn CA środowiska testowego, i zapisuje jego wystawcę, okres ważności oraz błąd walidacji. | Pozwala wykryć brak CA, niepoprawny łańcuch certyfikatów, niezgodną nazwę hosta lub nieważny certyfikat. |
| Lider klastra HA | Odpytuje `/v1/sys/leader` i sprawdza, czy tryb HA jest włączony oraz czy Vault wskazuje adres lidera. | Klaster bez lidera nie może poprawnie obsługiwać operacji zapisu. |
| Trzy nody RAFT | Odpytuje bezpośrednio nody `vault-1005`, `vault-1006` i `vault-1007`. Sprawdza, czy wszystkie są zainicjalizowane i odpieczętowane oraz czy istnieje dokładnie jeden node active i dwa nody standby. | Potwierdza, że cały klaster działa, a nie tylko publiczny endpoint. |
| Interfejs WWW | Otwiera `https://vault.rachuna.dev/ui/` w Chromium i sprawdza odpowiedź HTTP, tytuł strony oraz widoczność interfejsu. | Potwierdza działanie pełnej ścieżki: klient -> VIP -> HAProxy -> Vault UI. |

Test nodów sprawdza dodatkowo, czy wszystkie trzy instancje zwracają ten sam:

- identyfikator klastra,
- nazwę klastra,
- numer wersji Vault.

Dzięki temu wykrywamy sytuację, w której działający serwer nie należy do
oczekiwanego klastra albo ma inną wersję oprogramowania.

## Sprawdzana architektura

```text
                              +--------------------+
                              | vault.rachuna.dev  |
                              | VIP: 10.3.2.254    |
                              +---------+----------+
                                        |
                                     HAProxy
                                        |
                    +-------------------+-------------------+
                    |                   |                   |
          vault-1005.rachuna.dev  vault-1006.rachuna.dev  vault-1007.rachuna.dev
              10.3.2.5:8200         10.3.2.6:8200         10.3.2.7:8200
                    |                   |                   |
                    +------------- Vault RAFT HA -----------+
                              1 active + 2 standby
```

Adres publiczny sprawdza działanie VIP i HAProxy. Bezpośrednie adresy nodów
sprawdzają stan każdej instancji Vault niezależnie od load balancera.

## Uruchomienie

W devcontainerze wykonaj:

```bash
npm test
```

Poprawny wynik wygląda następująco:

```text
5 passed
```

Można uruchomić tylko wybraną grupę:

```bash
npm run test:api
npm run test:ui
```

- `test:api` uruchamia cztery testy API i TLS Vault.
- `test:ui` uruchamia test interfejsu WWW w Chromium.

## Pierwsze przygotowanie środowiska

Po utworzeniu nowego devcontainera zainstaluj zależności projektu:

```bash
npm ci
```

Playwright 1.60 nie rozpoznaje jeszcze Ubuntu 26.04. Dlatego Chromium i jego
biblioteki należy zainstalować przy użyciu kompatybilnego artefaktu Ubuntu
24.04:

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install-deps chromium
```

Te polecenia są potrzebne tylko podczas przygotowania nowego devcontainera.

## Raport

Po wykonaniu testów Playwright zapisuje:

- raport HTML w `playwright-report/index.html`,
- raport JSON w `playwright-report/results.json`,
- diagnostykę nieudanych testów w `test-results/`,
- odpowiedzi API Vault jako załączniki JSON,
- wynik walidacji certyfikatu w załączniku `tls-certificate.json`,
- zrzut ekranu interfejsu Vault.

Raport HTML można otworzyć poleceniem:

```bash
npm run report
```

## Jak interpretować błędy?

### Publiczny endpoint nie odpowiada

Prawdopodobny problem dotyczy DNS, VIP Keepalived, HAProxy, certyfikatu TLS albo
samej usługi Vault.

### Vault jest sealed lub uninitialized

Deployment uruchomił proces Vault, ale bootstrap albo auto-unseal nie zakończył
się poprawnie.

### Certyfikat TLS nie jest zaufany

Załącznik `tls-certificate.json` zawiera pole `authorizationError` z przyczyną,
na przykład brak zaufanego CA, wygasły certyfikat albo niezgodność nazwy hosta.
Ten test zawsze weryfikuje certyfikat, również gdy `VAULT_TLS_SKIP_VERIFY=true`.

### Brak lidera HA

Nody nie utworzyły poprawnego klastra RAFT albo nie mogą się ze sobą
komunikować.

### Jeden z nodów jest niedostępny

Publiczny endpoint może nadal działać, ale klaster nie ma oczekiwanej
redundancji. Szczegóły niedostępnych adresów znajdują się w załączniku
`unavailable-nodes.json`.

### Test UI nie przechodzi

API może działać, ale problem może dotyczyć HAProxy, routingu SNI, zasobów UI
albo przeglądarki zainstalowanej w devcontainerze.

## Konfiguracja

Domyślnie testy używają:

```text
VAULT_ADDR=https://vault.rachuna.dev
VAULT_NODE_URLS=https://vault-1005.rachuna.dev:8200,https://vault-1006.rachuna.dev:8200,https://vault-1007.rachuna.dev:8200
VAULT_TLS_SKIP_VERIFY=true
```

Wartości można nadpisać podczas uruchomienia:

```bash
VAULT_ADDR=https://vault.example.com \
VAULT_NODE_URLS=https://vault-1.example.com:8200,https://vault-2.example.com:8200,https://vault-3.example.com:8200 \
VAULT_TLS_SKIP_VERIFY=false \
npm test
```

`VAULT_TLS_SKIP_VERIFY=true` jest wartością domyślną, ponieważ środowisko
korzysta z wewnętrznego PKI. Ustaw `false`, jeśli CA klastra jest zaufane
przez devcontainer.
